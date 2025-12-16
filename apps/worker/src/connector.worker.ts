import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConnectorOrchestrator } from '@surplus/connectors';

@Injectable()
export class ConnectorWorkerService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorWorkerService.name);
  private readonly orchestrator = new ConnectorOrchestrator();
  private timer?: NodeJS.Timeout;

  async onModuleInit() {
    await this.runCycle();
    const intervalMs = Number(process.env.CONNECTOR_POLL_INTERVAL ?? 300_000);
    this.timer = setInterval(() => {
      void this.runCycle();
    }, intervalMs);
  }

  async runCycle() {
    try {
      const results = await this.orchestrator.runAllConnectors();
      this.logger.log(`Completed connector poll: ${results.length} connectors processed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Connector poll failed: ${message}`);
    }
  }

  getStatuses() {
    return this.orchestrator.getStatuses();
  }
}
