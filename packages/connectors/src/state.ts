import { NormalizedCase } from '@surplus/shared';

import {
  ConnectorAuditEvent,
  ConnectorConfig,
  ConnectorKey,
  ConnectorRunStatus,
  StoredCaseRecord
} from './types';
import { connectorKeyToString } from './registry';

const EMPTY_STATUS: ConnectorRunStatus = {
  extracted: 0,
  created: 0,
  failures: 0,
  lastCursor: null,
  lastError: null
};

export class ConnectorStateStore {
  private readonly statuses = new Map<string, ConnectorRunStatus>();
  private readonly cursors = new Map<string, string | null>();
  private readonly cases = new Map<string, StoredCaseRecord>();
  private readonly audits: ConnectorAuditEvent[] = [];

  getStatus(connector: ConnectorConfig): ConnectorRunStatus {
    return this.statuses.get(connectorKeyToString(connector.key)) ?? { ...EMPTY_STATUS };
  }

  setStatus(connector: ConnectorConfig, update: Partial<ConnectorRunStatus>): ConnectorRunStatus {
    const key = connectorKeyToString(connector.key);
    const current = this.getStatus(connector);
    const next = { ...current, ...update } satisfies ConnectorRunStatus;
    this.statuses.set(key, next);
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
