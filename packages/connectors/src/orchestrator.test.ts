import { describe, expect, test, vi } from 'vitest';

import { ConnectorOrchestrator } from './orchestrator';

class TestOrchestrator extends ConnectorOrchestrator {
  attempts = 0;

  override async runAllConnectors() {
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new Error('boom');
    }

    return [
      {
        connector: {
          key: { state: 'tx', county_code: '001' },
          spiderName: 'test',
          watchUrls: [],
          scheduleInterval: 0,
          parsingMode: 'raw'
        },
        status: 'ok'
      }
    ];
  }
}

describe('ConnectorOrchestrator retries', () => {
  test('retries failed run then succeeds', async () => {
    const orchestrator = new TestOrchestrator();
    const wait = vi.fn().mockResolvedValue(undefined);

    const results = await orchestrator.runAllConnectorsWithRetry({
      maxAttempts: 2,
      baseDelayMs: 10,
      wait
    });

    expect(results[0]?.status).toBe('ok');
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
