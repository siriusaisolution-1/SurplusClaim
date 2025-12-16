import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { QueueService } from './worker.queue';

@Module({
  providers: [QueueService],
  controllers: [HealthController]
})
export class WorkerModule {}
