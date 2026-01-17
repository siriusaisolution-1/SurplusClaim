import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { ConnectorWorkerService } from './connector.worker';
import { prisma } from './prisma.client';
import { QueueService } from './worker.queue';

const DEFAULT_COMMUNICATION_POLL_MS = 60_000;
const DEFAULT_DEADLINE_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Controller()
export class HealthController {
  constructor(
    private readonly queueService: QueueService,
    private readonly connectorWorkerService: ConnectorWorkerService
  ) {}

  @Get('health')
  async getHealth() {
    return {
      status: 'ok',
      service: 'worker',
      queue: this.queueService.queueName,
      connectors: await this.connectorWorkerService.getStatuses()
    };
  }

  @Get('ready')
  async getReady() {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'worker',
        message: 'Database unavailable'
      });
    }

    const communicationInterval = Number(process.env.COMMUNICATION_POLL_INTERVAL ?? DEFAULT_COMMUNICATION_POLL_MS);
    const reminderInterval = Number(process.env.DEADLINE_SCAN_INTERVAL_MS ?? DEFAULT_DEADLINE_SCAN_INTERVAL_MS);

    if (!Number.isFinite(communicationInterval) || communicationInterval <= 0) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'worker',
        message: 'Invalid COMMUNICATION_POLL_INTERVAL'
      });
    }

    if (!Number.isFinite(reminderInterval) || reminderInterval <= 0) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'worker',
        message: 'Invalid DEADLINE_SCAN_INTERVAL_MS'
      });
    }

    return {
      status: 'ok',
      service: 'worker',
      queue: this.queueService.queueName,
      loops: {
        communicationIntervalMs: communicationInterval,
        reminderIntervalMs: reminderInterval
      }
    };
  }
}
