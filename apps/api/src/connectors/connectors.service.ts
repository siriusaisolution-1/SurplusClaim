import { Injectable } from '@nestjs/common';
import { ConnectorRegistry, defaultConnectorStateStore } from '@surplus/connectors';

@Injectable()
export class ConnectorsService {
  private readonly registry = new ConnectorRegistry();
  private readonly state = defaultConnectorStateStore;

  getStatus() {
    return this.state.listStatuses(this.registry.list()).map(({ connector, status }) => ({
      state: connector.key.state,
      county_code: connector.key.county_code,
      spider: connector.spiderName,
      watch_urls: connector.watchUrls,
      schedule_interval: connector.scheduleInterval,
      parsing_mode: connector.parsingMode,
      last_run: status.lastRun ?? null,
      last_cursor: status.lastCursor ?? null,
      extracted: status.extracted,
      created: status.created,
      failures: status.failures,
      last_error: status.lastError ?? null
    }));
  }
}
