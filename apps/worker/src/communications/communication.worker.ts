import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CommunicationDirection, CommunicationChannel } from '@prisma/client';
import { AuditEngine } from '@surplus/audit';

import { prisma } from '../prisma.client';
import { StructuredLoggerService } from '../observability/structured-logger.service';

import { buildEmailProvider } from './email.provider';

const DEFAULT_POLL_MS = 60_000;

@Injectable()
export class CommunicationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly emailProvider = buildEmailProvider();
  private readonly auditEngine = new AuditEngine(prisma);
  private timer?: NodeJS.Timeout;

  constructor(private readonly logger: StructuredLoggerService) {}

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
    const dryRunEmails = ['true', '1', 'yes'].includes((process.env.DRY_RUN_EMAILS ?? '').toLowerCase());
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
        if (dryRunEmails) {
          await prisma.communication.update({
            where: { id: item.id },
            data: { status: 'skipped', providerMessageId: 'dry-run' }
          });
          this.logger.log({
            event: 'communication_skipped',
            tenantId: item.tenantId,
            caseRef: item.caseRef,
            communicationId: item.id,
            reason: 'dry_run'
          });
          continue;
        }
        const result = await this.emailProvider.send({
          to: item.recipient ?? '',
          subject: item.subject,
          body: item.body
        });

        await prisma.communication.update({
          where: { id: item.id },
          data: { status: 'sent', providerMessageId: result.messageId }
        });

        if (item.templateId === 'deadline_reminder') {
          try {
            await prisma.caseEvent.create({
              data: {
                tenantId: item.tenantId,
                caseId: item.caseId,
                caseRef: item.caseRef,
                type: 'DEADLINE_REMINDER_SENT',
                payload: {
                  templateId: item.templateId,
                  templateVersion: item.templateVersion,
                  provider: result.provider,
                  recipient: item.recipient,
                  sendAt: item.sendAt
                }
              }
            });

            await this.auditEngine.append({
              tenantId: item.tenantId,
              caseId: item.caseId,
              caseRef: item.caseRef,
              eventType: 'DEADLINE_REMINDER_SENT',
              actor: 'system',
              payload: {
                communicationId: item.id,
                provider: result.provider,
                recipient: item.recipient,
                sendAt: item.sendAt
              }
            });
          } catch (err) {
            this.logger.warn({
              event: 'reminder_audit_failed',
              tenantId: item.tenantId,
              caseRef: item.caseRef,
              communicationId: item.id,
              message: String(err)
            });
          }
        }

        if (item.templateId === 'submission_status_reminder') {
          try {
            await prisma.caseEvent.create({
              data: {
                tenantId: item.tenantId,
                caseId: item.caseId,
                caseRef: item.caseRef,
                type: 'SUBMISSION_REMINDER_SENT',
                payload: {
                  templateId: item.templateId,
                  templateVersion: item.templateVersion,
                  provider: result.provider,
                  recipient: item.recipient,
                  sendAt: item.sendAt
                }
              }
            });

            await this.auditEngine.append({
              tenantId: item.tenantId,
              caseId: item.caseId,
              caseRef: item.caseRef,
              eventType: 'SUBMISSION_REMINDER_SENT',
              actor: 'system',
              payload: {
                communicationId: item.id,
                provider: result.provider,
                recipient: item.recipient,
                sendAt: item.sendAt
              }
            });
          } catch (err) {
            this.logger.warn({
              event: 'submission_reminder_audit_failed',
              tenantId: item.tenantId,
              caseRef: item.caseRef,
              communicationId: item.id,
              message: String(err)
            });
          }
        }
        this.logger.log({
          event: 'communication_sent',
          tenantId: item.tenantId,
          caseRef: item.caseRef,
          communicationId: item.id,
          provider: result.provider
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        await prisma.communication.update({
          where: { id: item.id },
          data: { status: 'failed' }
        });
        this.logger.error({
          event: 'communication_send_failed',
          tenantId: item.tenantId,
          caseRef: item.caseRef,
          communicationId: item.id,
          message
        });
      }
    }
  }
}
