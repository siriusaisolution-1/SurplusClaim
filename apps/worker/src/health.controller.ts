import { Controller, Get } from '@nestjs/common';

import { QueueService } from './worker.queue';

@Controller('health')
export class HealthController {
  constructor(private readonly queueService: QueueService) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'worker',
      queue: this.queueService.queueName
    };
  }
}
