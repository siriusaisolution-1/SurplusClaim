import { randomUUID } from 'node:crypto';

import { connectorKeyToString } from './registry';
import { ConnectorConfig } from './types';

export type ConnectorRunStatusType = 'queued' | 'running' | 'success' | 'failed';

export interface ConnectorRunStats {
  extracted: number;
  created: number;
  failures: number;
  jobId?: string;
  caseRefs?: string[];
}

export interface ConnectorRunStore {
  getLatestCursor(connector: ConnectorConfig): Promise<string | null>;
  createRun(
    connector: ConnectorConfig,
    input: { status: ConnectorRunStatusType; startedAt: Date; cursor?: string | null; attemptCount?: number }
  ): Promise<{ id: string; attemptCount: number }>;
  updateRunStatus(
    runId: string,
    update: {
      status: ConnectorRunStatusType;
      finishedAt?: Date | null;
      errorMessage?: string | null;
      cursor?: string | null;
      stats?: ConnectorRunStats;
      attemptCount?: number;
    }
  ): Promise<void>;
  persistCursor(connector: ConnectorConfig, cursor: string | null): Promise<void>;
}

export class InMemoryConnectorRunStore implements ConnectorRunStore {
  private readonly runs = new Map<string, {
    connectorKey: string;
    cursor: string | null;
    status: ConnectorRunStatusType;
    attemptCount: number;
  }>();
  private readonly cursors = new Map<string, string | null>();

  private connectorKey(connector: ConnectorConfig): string {
    return `${connector.spiderName}:${connectorKeyToString(connector.key)}`;
  }

  async getLatestCursor(connector: ConnectorConfig): Promise<string | null> {
    return this.cursors.get(this.connectorKey(connector)) ?? null;
  }

  async createRun(
    connector: ConnectorConfig,
    input: { status: ConnectorRunStatusType; startedAt: Date; cursor?: string | null; attemptCount?: number }
  ): Promise<{ id: string; attemptCount: number }> {
    const id = randomUUID();
    const attemptCount = input.attemptCount ?? 1;
    this.runs.set(id, {
      connectorKey: this.connectorKey(connector),
      cursor: input.cursor ?? null,
      status: input.status,
      attemptCount
    });
    return { id, attemptCount };
  }

  async updateRunStatus(
    runId: string,
    update: {
      status: ConnectorRunStatusType;
      finishedAt?: Date | null;
      errorMessage?: string | null;
      cursor?: string | null;
      stats?: ConnectorRunStats;
      attemptCount?: number;
    }
  ): Promise<void> {
    const current = this.runs.get(runId);
    if (!current) return;
    this.runs.set(runId, {
      ...current,
      cursor: update.cursor ?? current.cursor,
      status: update.status,
      attemptCount: update.attemptCount ?? current.attemptCount
    });
  }

  async persistCursor(connector: ConnectorConfig, cursor: string | null): Promise<void> {
    this.cursors.set(this.connectorKey(connector), cursor ?? null);
  }
}
