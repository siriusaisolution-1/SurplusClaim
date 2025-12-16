import { NormalizedCase } from '@surplus/shared';

export type ParsingMode = 'raw' | 'normalized';

export interface ConnectorKey {
  state: string;
  county_code: string;
}

export interface ConnectorConfig {
  key: ConnectorKey;
  spiderName: string;
  watchUrls: string[];
  scheduleInterval: number; // seconds
  parsingMode: ParsingMode;
}

export interface ConnectorRunStatus {
  lastRun?: Date;
  lastCursor?: string | null;
  lastJobId?: string;
  extracted: number;
  created: number;
  failures: number;
  lastError?: string | null;
}

export interface ConnectorScrapedItem {
  state: string;
  county_code: string;
  property_id: string;
  sale_date?: string;
  raw: Record<string, unknown>;
  normalized?: Partial<NormalizedCase>;
  raw_sha256?: string;
  cursor?: string;
}

export interface ConnectorAuditEvent {
  event: 'connector_run_started' | 'connector_run_finished' | 'cases_created';
  at: Date;
  connector: ConnectorKey;
  payload?: Record<string, unknown>;
}

export interface StoredCaseRecord {
  caseRef: string;
  normalized: NormalizedCase;
  dedupeKey: string;
  connector: ConnectorKey;
  propertyId: string;
  saleDate?: string;
  rawSha256: string;
}
