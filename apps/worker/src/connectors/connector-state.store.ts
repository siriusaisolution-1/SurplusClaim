import { Prisma, PrismaClient } from '@prisma/client';
import {
  ConnectorAuditEvent,
  ConnectorConfig,
  ConnectorRunStatus,
  ConnectorStateStore,
  StoredCaseRecord
} from '@surplus/connectors';

type ConnectorStats = {
  extracted?: number;
  created?: number;
  failures?: number;
  jobId?: string;
};

export class PrismaConnectorStateStore implements ConnectorStateStore {
  private readonly cases = new Map<string, StoredCaseRecord>();
  private readonly audits: ConnectorAuditEvent[] = [];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantId: string
  ) {}

  private connectorId(connector: ConnectorConfig): string {
    return connector.spiderName;
  }

  private normalizeCursor(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  async getStatus(connector: ConnectorConfig): Promise<ConnectorRunStatus> {
    const [latestRun, latestCursor] = await Promise.all([
      this.prisma.connectorRun.findFirst({
        where: {
          tenantId: this.tenantId,
          connectorId: this.connectorId(connector),
          state: connector.key.state,
          countyCode: connector.key.county_code
        },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.connectorCursor.findFirst({
        where: {
          tenantId: this.tenantId,
          connectorId: this.connectorId(connector),
          state: connector.key.state,
          countyCode: connector.key.county_code
        }
      })
    ]);

    const stats = (latestRun?.stats ?? {}) as ConnectorStats;

    return {
      lastRun: latestRun?.startedAt,
      lastCursor: this.normalizeCursor(latestCursor?.cursor),
      lastJobId: stats.jobId,
      extracted: stats.extracted ?? 0,
      created: stats.created ?? 0,
      failures: stats.failures ?? 0,
      lastError: latestRun?.errorMessage ?? null
    };
  }

  async setStatus(connector: ConnectorConfig, update: Partial<ConnectorRunStatus>): Promise<ConnectorRunStatus> {
    void update;
    return this.getStatus(connector);
  }

  async listStatuses(
    connectors: ConnectorConfig[]
  ): Promise<Array<{ connector: ConnectorConfig; status: ConnectorRunStatus }>> {
    const statuses = await Promise.all(connectors.map((connector) => this.getStatus(connector)));
    return connectors.map((connector, index) => ({ connector, status: statuses[index] }));
  }

  async getCursor(connector: ConnectorConfig): Promise<string | null> {
    const record = await this.prisma.connectorCursor.findFirst({
      where: {
        tenantId: this.tenantId,
        connectorId: this.connectorId(connector),
        state: connector.key.state,
        countyCode: connector.key.county_code
      }
    });
    return this.normalizeCursor(record?.cursor);
  }

  async setCursor(connector: ConnectorConfig, cursor: string | null): Promise<void> {
    await this.prisma.connectorCursor.upsert({
      where: {
        tenantId_connectorId_state_countyCode: {
          tenantId: this.tenantId,
          connectorId: this.connectorId(connector),
          state: connector.key.state,
          countyCode: connector.key.county_code
        }
      },
      update: {
        cursor: cursor ?? Prisma.DbNull
      },
      create: {
        tenantId: this.tenantId,
        connectorId: this.connectorId(connector),
        state: connector.key.state,
        countyCode: connector.key.county_code,
        cursor: cursor ?? Prisma.DbNull
      }
    });
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
