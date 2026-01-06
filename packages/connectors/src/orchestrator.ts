import { CaseIngestionService } from './ingestion';
import { ConnectorRegistry } from './registry';
import { ScrapydClient } from './scrapyd-client';
import { ConnectorStateStore, defaultConnectorStateStore } from './state';
import { ConnectorAuditEvent, ConnectorConfig } from './types';

class IngestionError extends Error {
  constructor(
    readonly details: {
      jobId: string;
      cursor: string | null;
      extracted: number;
      created: number;
      failures: number;
    }
  ) {
    super('ingestion failures');
  }
}

export interface OrchestratorOptions {
  registry?: ConnectorRegistry;
  stateStore?: ConnectorStateStore;
  scrapydClient?: ScrapydClient;
}

export interface RunAllRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  wait?: (ms: number) => Promise<void>;
}

export class ConnectorOrchestrator {
  private readonly registry: ConnectorRegistry;
  private readonly state: ConnectorStateStore;
  private readonly scrapyd: ScrapydClient;
  private readonly ingestion: CaseIngestionService;

  constructor(options?: OrchestratorOptions) {
    this.registry = options?.registry ?? new ConnectorRegistry();
    this.state = options?.stateStore ?? defaultConnectorStateStore;
    this.scrapyd =
      options?.scrapydClient ?? new ScrapydClient(process.env.SCRAPYD_URL ?? 'http://localhost:6800');
    this.ingestion = new CaseIngestionService(this.state);
  }

  async runAllConnectors() {
    const results = [] as Array<{ connector: ConnectorConfig; status: string }>;
    for (const connector of this.registry.list()) {
      const status = await this.runConnector(connector);
      results.push({ connector, status });
    }
    return results;
  }

  async runAllConnectorsWithRetry(options?: RunAllRetryOptions) {
    const wait = options?.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const maxAttempts = options?.maxAttempts ?? 3;
    const baseDelayMs = options?.baseDelayMs ?? 1000;

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      try {
        return await this.runAllConnectors();
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }

        const delay = baseDelayMs * 2 ** (attempt - 1);
        await wait(delay);
      }
    }
  }

  private audit(connector: ConnectorConfig, event: ConnectorAuditEvent['event'], payload?: Record<string, unknown>) {
    this.state.audit({ event, at: new Date(), connector: connector.key, payload });
  }

  async runConnector(connector: ConnectorConfig): Promise<string> {
    const startedAt = new Date();
    const previousCursor = this.state.getCursor(connector);

    this.audit(connector, 'connector_run_started', { cursor: previousCursor });

    try {
      const jobId = await this.scrapyd.scheduleSpider(connector.spiderName, {
        cursor: previousCursor ?? undefined
      });

      const items = await this.scrapyd.fetchItems(jobId);
      const ingestion = this.ingestion.ingestBatch(connector, items);
      const cursor = ingestion.cursor ?? previousCursor ?? null;

      if (ingestion.failures.length > 0) {
        this.audit(connector, 'connector_run_finished', {
          jobId,
          extracted: items.length,
          created: ingestion.created.length,
          failures: ingestion.failures.length,
          error: 'ingestion failures'
        });

        throw new IngestionError({
          jobId,
          cursor,
          extracted: items.length,
          created: ingestion.created.length,
          failures: ingestion.failures.length
        });
      }

      this.state.setCursor(connector, cursor);
      this.state.setStatus(connector, {
        lastRun: startedAt,
        lastCursor: cursor,
        lastJobId: jobId,
        extracted: items.length,
        created: ingestion.created.length,
        failures: ingestion.failures.length,
        lastError: ingestion.failures.length > 0 ? 'ingestion failures' : null
      });

      this.audit(connector, 'connector_run_finished', {
        jobId,
        extracted: items.length,
        created: ingestion.created.length,
        failures: ingestion.failures.length
      });

      if (ingestion.created.length > 0) {
        this.audit(connector, 'cases_created', {
          jobId,
          case_refs: ingestion.created.map((created) => created.caseRef),
          count: ingestion.created.length
        });
      }

      return jobId;
    } catch (error) {
      if (error instanceof IngestionError) {
        this.state.setCursor(connector, error.details.cursor);
        this.state.setStatus(connector, {
          lastRun: startedAt,
          lastCursor: error.details.cursor,
          lastJobId: error.details.jobId,
          extracted: error.details.extracted,
          created: error.details.created,
          failures: error.details.failures,
          lastError: error.message
        });

        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.state.setStatus(connector, {
        lastRun: startedAt,
        extracted: 0,
        created: 0,
        failures: 1,
        lastError: message
      });
      this.audit(connector, 'connector_run_finished', { error: message });
      throw error;
    }
  }

  getStatuses() {
    return this.state.listStatuses(this.registry.list());
  }

  getStateStore() {
    return this.state;
  }
}
