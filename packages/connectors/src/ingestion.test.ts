import { generateCaseRef } from '@surplus/shared';
import { describe, expect, it, vi } from 'vitest';

import { ConnectorOrchestrator } from './orchestrator';
import { ConnectorRegistry } from './registry';
import { ConnectorStateStore } from './state';
import { ConnectorConfig, ConnectorScrapedItem } from './types';

class FakeScrapydClient {
  private jobCounter = 0;
  public readonly scheduleSpider = vi.fn(async (spider: string): Promise<string> => {
    this.jobCounter += 1;
    return `${spider}-job-${this.jobCounter}`;
  });

  constructor(private readonly items: ConnectorScrapedItem[]) {}

  async fetchItems(): Promise<ConnectorScrapedItem[]> {
    return this.items;
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
    const state = new ConnectorStateStore();
    const orchestrator = new ConnectorOrchestrator({
      registry,
      stateStore: state,
      scrapydClient: new FakeScrapydClient(items)
    });

    await orchestrator.runConnector(connector);
    await orchestrator.runConnector(connector);

    const storedCases = state.listCases();
    const status = state.getStatus(connector);

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
    const state = new ConnectorStateStore();
    const scrapyd = new FakeScrapydClient(items);
    const orchestrator = new ConnectorOrchestrator({
      registry,
      stateStore: state,
      scrapydClient: scrapyd,
      prefetchedItems: items
    });

    await expect(orchestrator.runConnector(connector)).rejects.toThrowError(/Normalized case validation failed/);

    const status = state.getStatus(connector);
    expect(status.failures).toBe(1);
    expect(state.listCases()).toHaveLength(0);
    expect(scrapyd.scheduleSpider).not.toHaveBeenCalled();
  });
});
