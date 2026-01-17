import { Module } from '@nestjs/common';

import { CommunicationWorkerService } from './communications/communication.worker';
import { ConnectorWorkerService } from './connector.worker';
import { HealthController } from './health.controller';
import { StructuredLoggerService } from './observability/structured-logger.service';
import { ReminderWorkerService } from './reminders/reminder.worker';
import { QueueService } from './worker.queue';

@Module({
  providers: [
    QueueService,
    ConnectorWorkerService,
    CommunicationWorkerService,
    ReminderWorkerService,
    StructuredLoggerService
  ],
  controllers: [HealthController]
})
export class WorkerModule {}
