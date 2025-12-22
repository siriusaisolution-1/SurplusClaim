import { Module } from '@nestjs/common';

import { CommunicationWorkerService } from './communications/communication.worker';
import { ConnectorWorkerService } from './connector.worker';
import { HealthController } from './health.controller';
import { ReminderWorkerService } from './reminders/reminder.worker';
import { QueueService } from './worker.queue';

@Module({
  providers: [QueueService, ConnectorWorkerService, CommunicationWorkerService, ReminderWorkerService],
  controllers: [HealthController]
})
export class WorkerModule {}
