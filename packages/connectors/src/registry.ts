import { ConnectorConfig, ConnectorKey, ParsingMode } from './types';

function keyToString(key: ConnectorKey): string {
  return `${key.state.toUpperCase()}-${key.county_code.toUpperCase()}`;
}

const DEFAULT_CONNECTORS: ConnectorConfig[] = [
  {
    key: { state: 'GA', county_code: 'FULTON' },
    spiderName: 'ga_fulton_overages',
    watchUrls: ['https://fultoncountyga.gov/overages'],
    scheduleInterval: 60 * 15,
    parsingMode: 'normalized' satisfies ParsingMode
  },
  {
    key: { state: 'TX', county_code: 'HARRIS' },
    spiderName: 'tx_harris_overages',
    watchUrls: ['https://www.hctax.net/Property/ExcessProceeds'],
    scheduleInterval: 60 * 30,
    parsingMode: 'normalized' satisfies ParsingMode
  },
  {
    key: { state: 'AZ', county_code: 'MARICOPA' },
    spiderName: 'az_maricopa_overages',
    watchUrls: ['https://www.maricopa.gov'],
    scheduleInterval: 60 * 60,
    parsingMode: 'raw' satisfies ParsingMode
  },
  {
    key: { state: 'TX', county_code: 'TRAVIS' },
    spiderName: 'html_table_overages',
    watchUrls: ['https://data.example.gov/overages/html-table'],
    scheduleInterval: 60 * 30,
    parsingMode: 'normalized' satisfies ParsingMode
  },
  {
    key: { state: 'FL', county_code: 'ORANGE' },
    spiderName: 'pdf_list_overages',
    watchUrls: ['https://data.example.gov/overages/pdf-list'],
    scheduleInterval: 60 * 45,
    parsingMode: 'normalized' satisfies ParsingMode
  },
  {
    key: { state: 'WA', county_code: 'KING' },
    spiderName: 'csv_feed_overages',
    watchUrls: ['https://data.example.gov/overages/csv-feed'],
    scheduleInterval: 60 * 20,
    parsingMode: 'normalized' satisfies ParsingMode
  }
];

export class ConnectorRegistry {
  private readonly connectors: Map<string, ConnectorConfig>;

  constructor(configs: ConnectorConfig[] = DEFAULT_CONNECTORS) {
    this.connectors = new Map(configs.map((config) => [keyToString(config.key), config]));
  }

  get(key: ConnectorKey): ConnectorConfig | undefined {
    return this.connectors.get(keyToString(key));
  }

  list(): ConnectorConfig[] {
    return Array.from(this.connectors.values());
  }
}

export function connectorKeyToString(key: ConnectorKey): string {
  return keyToString(key);
}
