import { generateCaseRef } from '@surplus/shared';
import { describe, expect, it } from 'vitest';

import { ConnectorOrchestrator } from './orchestrator';
import { ConnectorRegistry } from './registry';
import { InMemoryConnectorRunStore } from './run-store';
import { InMemoryConnectorStateStore } from './state';
import { ConnectorConfig, ConnectorScrapedItem } from './types';

class FakeScrapydClient {
  private jobCounter = 0;
  public readonly receivedCursors: Array<string | undefined> = [];

  constructor(private readonly batches: ConnectorScrapedItem[][]) {}

  async scheduleSpider(spider: string, args?: { cursor?: string }): Promise<string> {
    this.jobCounter += 1;
    this.receivedCursors.push(args?.cursor);
    return `${spider}-job-${this.jobCounter}`;
  }

  async fetchItems(): Promise<ConnectorScrapedItem[]> {
    return this.batches.shift() ?? [];
  }
}

function buildConnector(): ConnectorConfig {
  return {
    key: { state: 'GA', county_code: 'FULTON' },
    spiderName: 'ga_fulton_overages',
    watchUrls: ['https://fultoncountyga.gov/overages'],
    scheduleInterval: 60,
    parsingMode: 'normalized'
  };
}

describe('Connector ingestion pipeline', () => {
  it('is idempotent when the same output is ingested twice', async () => {
    const connector = buildConnector();
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

    const registry = new ConnectorRegistry([connector]);
    const state = new InMemoryConnectorStateStore();
    const orchestrator = new ConnectorOrchestrator({
      registry,
      stateStore: state,
      runStore: new InMemoryConnectorRunStore(),
      scrapydClient: new FakeScrapydClient([items, items])
    });

    await orchestrator.runConnector(connector);
    await orchestrator.runConnector(connector);

    const storedCases = await state.listCases();
    const status = await state.getStatus(connector);

    expect(storedCases).toHaveLength(1);
    expect(storedCases[0].caseRef).toBe(caseRef);
    expect(status.created).toBe(0);
    expect(status.extracted).toBe(1);
  });

  it('fails ingestion when the normalized payload does not pass schema validation', async () => {
    const connector = buildConnector();
    const items: ConnectorScrapedItem[] = [
      {
        state: 'GA',
        county_code: 'FULTON',
        property_id: 'XYZ',
        sale_date: '2024-04-01',
        raw: { property_id: 'XYZ' },
        normalized: {
          case_ref: 'INVALID-REFERENCE',
          filed_at: '2024-04-01',
          source_system: 'unit-test'
        }
      }
    ];

    const registry = new ConnectorRegistry([connector]);
    const state = new InMemoryConnectorStateStore();
    const orchestrator = new ConnectorOrchestrator({
      registry,
      stateStore: state,
      runStore: new InMemoryConnectorRunStore(),
      scrapydClient: new FakeScrapydClient([items])
    });

    await expect(orchestrator.runConnector(connector)).rejects.toThrow();

    const status = await state.getStatus(connector);
    expect(status.failures).toBe(1);
    await expect(state.listCases()).resolves.toHaveLength(0);
  });

  it('persists cursor across runs and resumes on next schedule', async () => {
    const connector = buildConnector();
    const caseRef = generateCaseRef({ state: 'GA', countycode: 'FULTON', date: '2024-02-01' });
    const items: ConnectorScrapedItem[] = [
      {
        state: 'GA',
        county_code: 'FULTON',
        property_id: '111',
        sale_date: '2024-02-01',
        raw: { property_id: '111' },
        raw_sha256: 'first',
        cursor: 'cursor-1',
        normalized: {
          case_ref: caseRef,
          source_system: 'unit-test',
          filed_at: '2024-02-01'
        }
      }
    ];

    const secondBatch: ConnectorScrapedItem[] = [
      {
        ...items[0],
        cursor: 'cursor-2',
        raw_sha256: 'second'
      }
    ];

    const registry = new ConnectorRegistry([connector]);
    const state = new InMemoryConnectorStateStore();
    const runStore = new InMemoryConnectorRunStore();
    const scrapyd = new FakeScrapydClient([items, secondBatch]);
    const orchestrator = new ConnectorOrchestrator({
      registry,
      stateStore: state,
      runStore,
      scrapydClient: scrapyd
    });

    await orchestrator.runConnector(connector);
    await orchestrator.runConnector(connector);

    await expect(runStore.getLatestCursor(connector)).resolves.toBe('cursor-2');
    expect(scrapyd.receivedCursors).toEqual([undefined, 'cursor-1']);
  });

  it('does not advance cursor when ingestion fails', async () => {
    const connector = buildConnector();
    const caseRef = generateCaseRef({ state: 'GA', countycode: 'FULTON', date: '2024-03-01' });
    const items: ConnectorScrapedItem[] = [
      {
        state: 'GA',
        county_code: 'FULTON',
        property_id: '222',
        sale_date: '2024-03-01',
        raw: { property_id: '222' },
        raw_sha256: 'good',
        cursor: 'cursor-1',
        normalized: {
          case_ref: caseRef,
          source_system: 'unit-test',
          filed_at: '2024-03-01'
        }
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

    const registry = new ConnectorRegistry([connector]);
    const state = new InMemoryConnectorStateStore();
    const runStore = new InMemoryConnectorRunStore();
    const scrapyd = new FakeScrapydClient([items, invalidBatch]);
    const orchestrator = new ConnectorOrchestrator({
      registry,
      stateStore: state,
      runStore,
      scrapydClient: scrapyd
    });

    await orchestrator.runConnector(connector);
    await expect(orchestrator.runConnector(connector)).rejects.toThrow();

    await expect(runStore.getLatestCursor(connector)).resolves.toBe('cursor-1');
    expect(scrapyd.receivedCursors).toEqual([undefined, 'cursor-1']);
  });
});
