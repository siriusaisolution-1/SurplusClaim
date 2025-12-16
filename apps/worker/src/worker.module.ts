import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { QueueService } from './worker.queue';
import { ConnectorWorkerService } from './connector.worker';

@Module({
  providers: [QueueService, ConnectorWorkerService],
  controllers: [HealthController]
})
export class WorkerModule {}
