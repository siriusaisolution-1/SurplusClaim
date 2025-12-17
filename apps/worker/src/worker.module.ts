import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { QueueService } from './worker.queue';
import { ConnectorWorkerService } from './connector.worker';
import { CommunicationWorkerService } from './communications/communication.worker';
import { ReminderWorkerService } from './reminders/reminder.worker';

@Module({
  providers: [QueueService, ConnectorWorkerService, CommunicationWorkerService, ReminderWorkerService],
  controllers: [HealthController]
})
export class WorkerModule {}
