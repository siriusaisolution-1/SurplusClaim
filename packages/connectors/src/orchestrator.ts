import { CaseIngestionService } from './ingestion';
import { ConnectorRegistry, connectorKeyToString } from './registry';
import { ScrapydClient } from './scrapyd-client';
import { ConnectorRunStore, InMemoryConnectorRunStore } from './run-store';
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
  runStore?: ConnectorRunStore;
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
  private readonly runs: ConnectorRunStore;
  private readonly scrapyd: ScrapydClient;
  private readonly ingestion: CaseIngestionService;

  constructor(options?: OrchestratorOptions) {
    this.registry = options?.registry ?? new ConnectorRegistry();
    this.state = options?.stateStore ?? defaultConnectorStateStore;
    this.runs = options?.runStore ?? new InMemoryConnectorRunStore();
    this.scrapyd =
      options?.scrapydClient ?? new ScrapydClient(process.env.SCRAPYD_URL ?? 'http://localhost:6800');
    this.ingestion = new CaseIngestionService(this.state);
  }

  async runAllConnectors(runContext?: Map<string, { runId: string; attemptCount: number }>) {
    const results = [] as Array<{ connector: ConnectorConfig; status: string }>;
    for (const connector of this.registry.list()) {
      const runKey = connectorKeyToString(connector.key);
      const context = runContext?.get(runKey);
      const { jobId, runId, attemptCount } = await this.runConnector(connector, context);
      runContext?.set(runKey, { runId, attemptCount });
      const status = jobId;
      results.push({ connector, status });
    }
    return results;
  }

  async runAllConnectorsWithRetry(options?: RunAllRetryOptions) {
    const wait = options?.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const maxAttempts = options?.maxAttempts ?? 3;
    const baseDelayMs = options?.baseDelayMs ?? 1000;

    const runContext = new Map<string, { runId: string; attemptCount: number }>();
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      try {
        return await this.runAllConnectors(runContext);
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

  async runConnector(
    connector: ConnectorConfig,
    context?: { runId: string; attemptCount: number }
  ): Promise<{ jobId: string; runId: string; attemptCount: number }> {
    const startedAt = new Date();
    const previousCursor = await this.runs.getLatestCursor(connector);

    this.audit(connector, 'connector_run_started', { cursor: previousCursor });

    const attemptCount = (context?.attemptCount ?? 0) + 1;
    const runRecord = context?.runId
      ? { id: context.runId, attemptCount }
      : await this.runs.createRun(connector, {
          status: 'running',
          startedAt,
          cursor: previousCursor,
          attemptCount
        });

    if (context?.runId) {
      await this.runs.updateRunStatus(runRecord.id, {
        status: 'running',
        cursor: previousCursor,
        attemptCount,
        finishedAt: null,
        errorMessage: null
      });
    }

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

        await this.runs.updateRunStatus(runRecord.id, {
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: 'ingestion failures',
          cursor,
          stats: {
            extracted: items.length,
            created: ingestion.created.length,
            failures: ingestion.failures.length,
            jobId
          },
          attemptCount
        });

        throw new IngestionError({
          jobId,
          cursor,
          extracted: items.length,
          created: ingestion.created.length,
          failures: ingestion.failures.length
        });
      }

      await this.runs.persistCursor(connector, cursor);
      await this.runs.updateRunStatus(runRecord.id, {
        status: 'success',
        finishedAt: new Date(),
        cursor,
        stats: {
          extracted: items.length,
          created: ingestion.created.length,
          failures: ingestion.failures.length,
          jobId,
          caseRefs: ingestion.created.map((created) => created.caseRef)
        },
        attemptCount
      });

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

      return { jobId, runId: runRecord.id, attemptCount };
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
      await this.runs.updateRunStatus(runRecord.id, {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: message,
        cursor: previousCursor,
        stats: {
          extracted: 0,
          created: 0,
          failures: 1
        },
        attemptCount
      });
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
