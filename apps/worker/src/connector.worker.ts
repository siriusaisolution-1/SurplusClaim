import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConnectorOrchestrator } from '@surplus/connectors';

@Injectable()
export class ConnectorWorkerService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorWorkerService.name);
  private readonly orchestrator = new ConnectorOrchestrator();
  private timer?: NodeJS.Timeout;
  private isRunning = false;
  private failureCount = 0;
  private readonly pollIntervalMs = Number(process.env.CONNECTOR_POLL_INTERVAL ?? 300_000);
  private readonly retryAttempts = Number(process.env.CONNECTOR_MAX_ATTEMPTS ?? 3);
  private readonly retryBaseDelayMs = Number(process.env.CONNECTOR_RETRY_DELAY ?? 5_000);

  async onModuleInit() {
    await this.runCycle();
  }

  async runCycle() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const results = await this.orchestrator.runAllConnectorsWithRetry({
        maxAttempts: this.retryAttempts,
        baseDelayMs: this.retryBaseDelayMs
      });
      this.failureCount = 0;
      this.logger.log(`Completed connector poll: ${results.length} connectors processed`);
      this.scheduleNext(this.pollIntervalMs);
    } catch (error) {
      this.failureCount += 1;
      const message = error instanceof Error ? error.message : 'unknown error';
      const delay = Math.min(this.pollIntervalMs, this.retryBaseDelayMs * 2 ** (this.failureCount - 1));
      this.logger.error(`Connector poll failed: ${message}; retrying in ${delay}ms`);
      this.scheduleNext(delay);
    } finally {
      this.isRunning = false;
    }
  }

  getStatuses() {
    return this.orchestrator.getStatuses();
  }

  private scheduleNext(delay: number) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      void this.runCycle();
    }, delay);
  }
}
