import assert from 'node:assert';

import { ConnectorRunStatus, Prisma, PrismaClient } from '@prisma/client';
import {
  ConnectorConfig,
  ConnectorOrchestrator,
  ConnectorRegistry,
  ConnectorScrapedItem,
  InMemoryConnectorStateStore,
  ParsingMode,
  ScrapydClient
} from '@surplus/connectors';
import { generateCaseRef } from '@surplus/shared';

import { prisma } from '../src/prisma/prisma.client';

class FakeScrapydClient extends ScrapydClient {
  private jobCounter = 0;
  public readonly receivedCursors: Array<string | undefined> = [];

  constructor(private batches: ConnectorScrapedItem[][]) {
    const baseUrl = 'http://localhost:6800';
    const project = 'default';
    super(baseUrl, project);
  }

  async scheduleSpider(_spider: string, settings: Record<string, unknown> = {}) {
    this.jobCounter += 1;
    const cursor = typeof settings.cursor === 'string' ? settings.cursor : undefined;
    this.receivedCursors.push(cursor);
    return `job-${this.jobCounter}`;
  }

  async fetchItems(_jobId: string) {
    return this.batches.shift() ?? [];
  }
}

class PrismaConnectorRunStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly tenantId: string
  ) {}

  private connectorId(connector: { spiderName: string }) {
    return connector.spiderName;
  }

  async getLatestCursor(connector: { spiderName: string; key: { state: string; county_code: string } }) {
    const record = await this.client.connectorCursor.findFirst({
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
    connector: { spiderName: string; key: { state: string; county_code: string } },
    input: { status: 'queued' | 'running' | 'success' | 'failed'; startedAt: Date; cursor?: string | null; attemptCount?: number }
  ) {
    const run = await this.client.connectorRun.create({
      data: {
        tenantId: this.tenantId,
        connectorId: this.connectorId(connector),
        state: connector.key.state,
        countyCode: connector.key.county_code,
        status: ConnectorRunStatus[input.status.toUpperCase() as keyof typeof ConnectorRunStatus],
        startedAt: input.startedAt,
        cursor: input.cursor ?? undefined,
        attemptCount: input.attemptCount ?? 1
      },
      select: { id: true, attemptCount: true }
    });
    return run;
  }

  async updateRunStatus(
    runId: string,
    update: {
      status: 'queued' | 'running' | 'success' | 'failed';
      finishedAt?: Date | null;
      errorMessage?: string | null;
      cursor?: string | null;
      stats?: unknown;
      attemptCount?: number;
    }
  ) {
    await this.client.connectorRun.update({
      where: { id: runId },
      data: {
        status: ConnectorRunStatus[update.status.toUpperCase() as keyof typeof ConnectorRunStatus],
        finishedAt: update.finishedAt ?? undefined,
        errorMessage: update.errorMessage ?? undefined,
        cursor: update.cursor ?? undefined,
        stats: update.stats ?? undefined,
        attemptCount: update.attemptCount ?? undefined
      }
    });
  }

  async persistCursor(connector: { spiderName: string; key: { state: string; county_code: string } }, cursor: string | null) {
    await this.client.connectorCursor.upsert({
      where: {
        tenantId_connectorId_state_countyCode: {
          tenantId: this.tenantId,
          connectorId: this.connectorId(connector),
          state: connector.key.state,
          countyCode: connector.key.county_code
        }
      },
      update: { cursor: cursor ?? Prisma.JsonNull },
      create: {
        tenantId: this.tenantId,
        connectorId: this.connectorId(connector),
        state: connector.key.state,
        countyCode: connector.key.county_code,
        cursor: cursor ?? Prisma.JsonNull
      }
    });
  }
}

async function run() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "ConnectorRun", "ConnectorCursor", "Tenant" CASCADE;');
  const tenant = await prisma.tenant.create({ data: { name: 'Connector Test Tenant' } });

  const connector: ConnectorConfig = {
    key: { state: 'GA', county_code: 'FULTON' },
    spiderName: 'ga_fulton_overages',
    watchUrls: ['https://fultoncountyga.gov/overages'],
    scheduleInterval: 60,
    parsingMode: 'normalized' satisfies ParsingMode
  };

  const caseRef = generateCaseRef({ state: 'GA', countycode: 'FULTON', date: '2024-01-01' });

  const items: ConnectorScrapedItem[] = [
    {
      state: 'GA',
      county_code: 'FULTON',
      property_id: '123',
      sale_date: '2024-01-01',
      raw: { property_id: '123' },
      raw_sha256: 'abc123',
      cursor: 'cursor-1',
      normalized: {
        case_ref: caseRef,
        source_system: 'unit-test',
        filed_at: '2024-01-01'
      }
    }
  ];

  const secondBatch: ConnectorScrapedItem[] = [
    {
      ...items[0],
      cursor: 'cursor-2'
    }
  ];

  const invalidBatch: ConnectorScrapedItem[] = [
    {
      state: 'GA',
      county_code: 'FULTON',
      property_id: '999',
      sale_date: '2024-04-01',
      raw: { property_id: '999' },
      normalized: {
        case_ref: 'INVALID-REFERENCE',
        filed_at: '2024-04-01',
        source_system: 'unit-test'
      }
    }
  ];

  const scrapyd = new FakeScrapydClient([items, secondBatch, invalidBatch]);
  const registry = new ConnectorRegistry([connector]);
  const stateStore = new InMemoryConnectorStateStore();
  const runStore = new PrismaConnectorRunStore(prisma, tenant.id);

  const orchestrator = new ConnectorOrchestrator({
    registry,
    stateStore,
    runStore,
    scrapydClient: scrapyd
  });

  await orchestrator.runConnector(connector);
  await orchestrator.runConnector(connector);
  await assert.rejects(async () => orchestrator.runConnector(connector));

  const cursorRecord = await prisma.connectorCursor.findFirst({
    where: {
      tenantId: tenant.id,
      connectorId: connector.spiderName,
      state: connector.key.state,
      countyCode: connector.key.county_code
    }
  });

  assert.strictEqual(cursorRecord?.cursor, 'cursor-2');
  assert.deepStrictEqual(scrapyd.receivedCursors, [undefined, 'cursor-1', 'cursor-2']);

  const runs = await prisma.connectorRun.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' }
  });

  assert.strictEqual(runs.length, 3);
  assert.strictEqual(runs[1].status, ConnectorRunStatus.SUCCESS);
  assert.strictEqual(runs[2].status, ConnectorRunStatus.FAILED);
  assert.ok(runs[2].errorMessage);

  const secondStats = runs[1].stats as { created?: number } | null;
  assert.strictEqual(secondStats?.created ?? 0, 0);
}

run()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    return prisma.$disconnect().finally(() => {
      process.exit(1);
    });
  });
