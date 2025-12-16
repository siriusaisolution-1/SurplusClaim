import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CommunicationDirection, CommunicationChannel } from '@prisma/client';

import { buildEmailProvider } from './email.provider';
import { prisma } from '../prisma.client';

const DEFAULT_POLL_MS = 60_000;

@Injectable()
export class CommunicationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommunicationWorkerService.name);
  private readonly emailProvider = buildEmailProvider();
  private timer?: NodeJS.Timeout;

  async onModuleInit() {
    await this.processPending();
    const intervalMs = Number(process.env.COMMUNICATION_POLL_INTERVAL ?? DEFAULT_POLL_MS);
    this.timer = setInterval(() => {
      void this.processPending();
    }, intervalMs);
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async processPending() {
    const now = new Date();
    const pending = await prisma.communication.findMany({
      where: {
        status: { in: ['pending', 'pending_auto'] },
        direction: CommunicationDirection.OUTBOUND,
        channel: CommunicationChannel.EMAIL,
        sendAt: { lte: now }
      },
      orderBy: { sendAt: 'asc' },
      take: 25
    });

    for (const item of pending) {
      try {
        const result = await this.emailProvider.send({
          to: item.recipient ?? '',
          subject: item.subject,
          body: item.body
        });

        await prisma.communication.update({
          where: { id: item.id },
          data: { status: 'sent', providerMessageId: result.messageId }
        });
        this.logger.log(`Sent communication ${item.id} via ${result.provider}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        await prisma.communication.update({
          where: { id: item.id },
          data: { status: 'failed' }
        });
        this.logger.error(`Failed to send communication ${item.id}: ${message}`);
      }
    }
  }
}
