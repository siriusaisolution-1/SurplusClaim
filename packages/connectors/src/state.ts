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

export interface ConnectorStateStore {
  getStatus(connector: ConnectorConfig): Promise<ConnectorRunStatus>;
  setStatus(connector: ConnectorConfig, update: Partial<ConnectorRunStatus>): Promise<ConnectorRunStatus>;
  listStatuses(connectors: ConnectorConfig[]): Promise<Array<{ connector: ConnectorConfig; status: ConnectorRunStatus }>>;
  getCursor(connector: ConnectorConfig): Promise<string | null>;
  setCursor(connector: ConnectorConfig, cursor: string | null): Promise<void>;
  rememberCase(record: StoredCaseRecord): Promise<void>;
  findCase(dedupeKey: string): Promise<StoredCaseRecord | undefined>;
  listCases(): Promise<StoredCaseRecord[]>;
  audit(event: ConnectorAuditEvent): Promise<void>;
  listAudits(): Promise<ConnectorAuditEvent[]>;
}

export class InMemoryConnectorStateStore implements ConnectorStateStore {
  private readonly statuses = new Map<string, ConnectorRunStatus>();
  private readonly cursors = new Map<string, string | null>();
  private readonly cases = new Map<string, StoredCaseRecord>();
  private readonly audits: ConnectorAuditEvent[] = [];

  constructor() {}

  async getStatus(connector: ConnectorConfig): Promise<ConnectorRunStatus> {
    return this.statuses.get(connectorKeyToString(connector.key)) ?? { ...EMPTY_STATUS };
  }

  async setStatus(connector: ConnectorConfig, update: Partial<ConnectorRunStatus>): Promise<ConnectorRunStatus> {
    const key = connectorKeyToString(connector.key);
    const current = await this.getStatus(connector);
    const next = { ...current, ...update } satisfies ConnectorRunStatus;
    this.statuses.set(key, next);
    return next;
  }

  async listStatuses(
    connectors: ConnectorConfig[]
  ): Promise<Array<{ connector: ConnectorConfig; status: ConnectorRunStatus }>> {
    const statuses = await Promise.all(connectors.map((connector) => this.getStatus(connector)));
    return connectors.map((connector, index) => ({ connector, status: statuses[index] }));
  }

  async getCursor(connector: ConnectorConfig): Promise<string | null> {
    return this.cursors.get(connectorKeyToString(connector.key)) ?? null;
  }

  async setCursor(connector: ConnectorConfig, cursor: string | null): Promise<void> {
    this.cursors.set(connectorKeyToString(connector.key), cursor);
  }

  async rememberCase(record: StoredCaseRecord): Promise<void> {
    this.cases.set(record.dedupeKey, record);
  }

  async findCase(dedupeKey: string): Promise<StoredCaseRecord | undefined> {
    return this.cases.get(dedupeKey);
  }

  async listCases(): Promise<StoredCaseRecord[]> {
    return Array.from(this.cases.values());
  }

  async audit(event: ConnectorAuditEvent): Promise<void> {
    this.audits.push(event);
  }

  async listAudits(): Promise<ConnectorAuditEvent[]> {
    return this.audits;
  }
}

export const defaultConnectorStateStore = new InMemoryConnectorStateStore();

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
