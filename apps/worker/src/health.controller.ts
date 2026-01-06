import { Controller, Get } from '@nestjs/common';

import { ConnectorWorkerService } from './connector.worker';
import { QueueService } from './worker.queue';

@Controller('health')
export class HealthController {
  constructor(
    private readonly queueService: QueueService,
    private readonly connectorWorkerService: ConnectorWorkerService
  ) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'worker',
      queue: this.queueService.queueName,
      connectors: this.connectorWorkerService.getStatuses()
    };
  }
}
