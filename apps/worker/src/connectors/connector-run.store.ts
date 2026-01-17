import { ConnectorRunStatus, Prisma, PrismaClient } from '@prisma/client';
import { ConnectorConfig, ConnectorRunStats, ConnectorRunStatusType, ConnectorRunStore } from '@surplus/connectors';

const toStatusEnum = (status: ConnectorRunStatusType): ConnectorRunStatus => {
  switch (status) {
    case 'queued':
      return ConnectorRunStatus.QUEUED;
    case 'running':
      return ConnectorRunStatus.RUNNING;
    case 'success':
      return ConnectorRunStatus.SUCCESS;
    case 'failed':
      return ConnectorRunStatus.FAILED;
  }
};

export class PrismaConnectorRunStore implements ConnectorRunStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantId: string
  ) {}

  private connectorId(connector: ConnectorConfig): string {
    return connector.spiderName;
  }

  async getLatestCursor(connector: ConnectorConfig): Promise<string | null> {
    const record = await this.prisma.connectorCursor.findFirst({
      where: {
        tenantId: this.tenantId,
        connectorId: this.connectorId(connector),
        state: connector.key.state,
        countyCode: connector.key.county_code
      }
    });

    if (!record?.cursor) return null;
    return typeof record.cursor === 'string' ? record.cursor : JSON.stringify(record.cursor);
  }

  async createRun(
    connector: ConnectorConfig,
    input: { status: ConnectorRunStatusType; startedAt: Date; cursor?: string | null; attemptCount?: number }
  ): Promise<{ id: string; attemptCount: number }> {
    const run = await this.prisma.connectorRun.create({
      data: {
        tenantId: this.tenantId,
        connectorId: this.connectorId(connector),
        state: connector.key.state,
        countyCode: connector.key.county_code,
        status: toStatusEnum(input.status),
        startedAt: input.startedAt,
        cursor: input.cursor ?? undefined,
        attemptCount: input.attemptCount ?? 1
      },
      select: {
        id: true,
        attemptCount: true
      }
    });

    return run;
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
    await this.prisma.connectorRun.update({
      where: { id: runId },
      data: {
        status: toStatusEnum(update.status),
        finishedAt: update.finishedAt ?? undefined,
        errorMessage: update.errorMessage ?? undefined,
        cursor: update.cursor === undefined ? undefined : update.cursor ?? Prisma.DbNull,
        stats: update.stats ? (update.stats as unknown as Prisma.InputJsonValue) : undefined,
        attemptCount: update.attemptCount ?? undefined
      }
    });
  }

  async persistCursor(connector: ConnectorConfig, cursor: string | null): Promise<void> {
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
}
