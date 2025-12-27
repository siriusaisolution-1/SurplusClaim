import { CaseIngestionService } from './ingestion';
import { ConnectorRegistry } from './registry';
import { ScrapydClient } from './scrapyd-client';
import { ConnectorStateStore, defaultConnectorStateStore } from './state';
import { ConnectorAuditEvent, ConnectorConfig } from './types';

export interface OrchestratorOptions {
  registry?: ConnectorRegistry;
  stateStore?: ConnectorStateStore;
  scrapydClient?: ScrapydClient;
}

class IngestionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionFailedError';
  }
}

export class ConnectorOrchestrator {
  private readonly registry: ConnectorRegistry;
  private readonly state: ConnectorStateStore;
  private readonly scrapyd: ScrapydClient;
  private readonly ingestion: CaseIngestionService;

  private static readonly INGESTION_ERROR = 'ingestion failures';

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

      this.state.setCursor(connector, cursor);
      this.state.setStatus(connector, {
        lastRun: startedAt,
        lastCursor: cursor,
        lastJobId: jobId,
        extracted: items.length,
        created: ingestion.created.length,
        failures: ingestion.failures.length,
        lastError: ingestion.failures.length > 0 ? ConnectorOrchestrator.INGESTION_ERROR : null
      });

      this.audit(connector, 'connector_run_finished', {
        jobId,
        extracted: items.length,
        created: ingestion.created.length,
        failures: ingestion.failures.length
      });

      if (ingestion.failures.length > 0) {
        throw new IngestionFailedError(ConnectorOrchestrator.INGESTION_ERROR);
      }

      if (ingestion.created.length > 0) {
        this.audit(connector, 'cases_created', {
          jobId,
          case_refs: ingestion.created.map((created) => created.caseRef),
          count: ingestion.created.length
        });
      }

      return jobId;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!(error instanceof IngestionFailedError)) {
        this.state.setStatus(connector, {
          lastRun: startedAt,
          extracted: 0,
          created: 0,
          failures: 1,
          lastError: message
        });
        this.audit(connector, 'connector_run_finished', { error: message });
      }
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
