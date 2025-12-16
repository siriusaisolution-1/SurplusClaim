import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService {
  public readonly queueName = process.env.WORK_QUEUE_NAME ?? 'surplus-jobs';
  public readonly queue: Queue;

  constructor() {
    this.queue = new Queue(this.queueName, {
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379)
      }
    });
  }
}
