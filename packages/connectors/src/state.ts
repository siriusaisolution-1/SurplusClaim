import fs from 'node:fs';
import path from 'node:path';

import { NormalizedCase } from '@surplus/shared';

import { connectorKeyToString } from './registry';
import {
  ConnectorAuditEvent,
  ConnectorConfig,
  ConnectorKey,
  ConnectorRunStatus,
  StoredCaseRecord
} from './types';

const EMPTY_STATUS: ConnectorRunStatus = {
  extracted: 0,
  created: 0,
  failures: 0,
  lastCursor: null,
  lastError: null
};

type PersistedStatus = Omit<ConnectorRunStatus, 'lastRun'> & { lastRun?: string };

interface ConnectorStateStoreOptions {
  persistPath?: string;
}

export class ConnectorStateStore {
  private readonly persistPath?: string;
  private readonly statuses = new Map<string, ConnectorRunStatus>();
  private readonly cursors = new Map<string, string | null>();
  private readonly cases = new Map<string, StoredCaseRecord>();
  private readonly audits: ConnectorAuditEvent[] = [];

  constructor(options?: ConnectorStateStoreOptions) {
    this.persistPath = options?.persistPath ?? process.env.CONNECTOR_STATE_PATH ?? 'connector-state.json';
    this.load();
  }

  getStatus(connector: ConnectorConfig): ConnectorRunStatus {
    return this.statuses.get(connectorKeyToString(connector.key)) ?? { ...EMPTY_STATUS };
  }

  setStatus(connector: ConnectorConfig, update: Partial<ConnectorRunStatus>): ConnectorRunStatus {
    const key = connectorKeyToString(connector.key);
    const current = this.getStatus(connector);
    const next = { ...current, ...update } satisfies ConnectorRunStatus;
    this.statuses.set(key, next);
    this.persist();
    return next;
  }

  listStatuses(connectors: ConnectorConfig[]): Array<{ connector: ConnectorConfig; status: ConnectorRunStatus }> {
    return connectors.map((connector) => ({ connector, status: this.getStatus(connector) }));
  }

  getCursor(connector: ConnectorConfig): string | null {
    return this.cursors.get(connectorKeyToString(connector.key)) ?? null;
  }

  setCursor(connector: ConnectorConfig, cursor: string | null): void {
    this.cursors.set(connectorKeyToString(connector.key), cursor);
    this.persist();
  }

  rememberCase(record: StoredCaseRecord): void {
    this.cases.set(record.dedupeKey, record);
  }

  findCase(dedupeKey: string): StoredCaseRecord | undefined {
    return this.cases.get(dedupeKey);
  }

  listCases(): StoredCaseRecord[] {
    return Array.from(this.cases.values());
  }

  audit(event: ConnectorAuditEvent): void {
    this.audits.push(event);
  }

  listAudits(): ConnectorAuditEvent[] {
    return this.audits;
  }

  private persist() {
    if (!this.persistPath) return;

    const dir = path.dirname(this.persistPath);
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const statuses = Object.fromEntries(
      Array.from(this.statuses.entries()).map(([key, status]) => [key, this.serializeStatus(status)])
    );

    const data = {
      statuses,
      cursors: Object.fromEntries(this.cursors.entries())
    } satisfies Record<string, unknown>;

    fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
  }

  private load() {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf8')) as {
        statuses?: Record<string, PersistedStatus>;
        cursors?: Record<string, string | null>;
      };

      Object.entries(raw.statuses ?? {}).forEach(([key, status]) => {
        this.statuses.set(key, this.deserializeStatus(status));
      });

      Object.entries(raw.cursors ?? {}).forEach(([key, cursor]) => {
        this.cursors.set(key, cursor);
      });
    } catch {
      // ignore malformed persisted state
    }
  }

  private serializeStatus(status: ConnectorRunStatus): PersistedStatus {
    return {
      ...status,
      lastRun: status.lastRun ? status.lastRun.toISOString() : undefined
    };
  }

  private deserializeStatus(status: PersistedStatus): ConnectorRunStatus {
    return {
      ...status,
      lastRun: status.lastRun ? new Date(status.lastRun) : undefined
    } satisfies ConnectorRunStatus;
  }
}

export const defaultConnectorStateStore = new ConnectorStateStore();

export interface IngestionResult {
  created: StoredCaseRecord[];
  skipped: StoredCaseRecord[];
  failures: Array<{ item: unknown; error: string }>;
  cursor?: string | null;
}

export interface CaseBuilderInput {
  caseRef: string;
  normalized: NormalizedCase;
  rawSha256: string;
  propertyId: string;
  saleDate?: string;
  connector: ConnectorKey;
}
