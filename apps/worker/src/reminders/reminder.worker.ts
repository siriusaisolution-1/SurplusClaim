import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CaseStatus, CommunicationChannel, CommunicationDirection, Prisma } from '@prisma/client';
import { AuditEngine } from '@surplus/audit';
import { templateRegistry } from '@surplus/shared';

import { StructuredLoggerService } from '../observability/structured-logger.service';
import { prisma } from '../prisma.client';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCAN_INTERVAL_MS = DAY_MS;
const DEFAULT_SUBMISSION_REMINDER_DAYS = 7;
const DEFAULT_DAILY_COMMS_CAP = 200;
const DEFAULT_DAILY_AUTO_REMINDERS_CAP = 50;

type ProceduralDeadline = { name: string; dueDate: Date };

@Injectable()
export class ReminderWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly auditEngine = new AuditEngine(prisma);
  private timer?: NodeJS.Timeout;

  constructor(private readonly logger: StructuredLoggerService) {}

  async onModuleInit() {
    await this.scanAndSchedule();
    const interval = Number(process.env.DEADLINE_SCAN_INTERVAL_MS ?? DEFAULT_SCAN_INTERVAL_MS);
    this.timer = setInterval(() => {
      void this.scanAndSchedule();
    }, interval);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async scanAndSchedule() {
    await this.scheduleSubmissionReminders();

    const cases = await prisma.case.findMany({
      where: {
        status: { notIn: [CaseStatus.CLOSED, CaseStatus.PAYOUT_CONFIRMED] },
        metadata: { not: Prisma.DbNull }
      },
      include: { assignedReviewer: true }
    });

    type CaseWithReviewer = Prisma.CaseGetPayload<{ include: { assignedReviewer: true } }>;

    for (const caseRecord of cases as CaseWithReviewer[]) {
      const deadlines = this.extractDeadlines(caseRecord.metadata as Record<string, unknown> | null);
      const next = this.pickNextDeadline(deadlines);
      if (!next) {
        continue;
      }

      const recipientEmail = caseRecord.assignedReviewer?.email ?? process.env.DEFAULT_REMINDER_RECIPIENT;
      const recipientName = caseRecord.assignedReviewer?.fullName ?? 'Case team';
      const replyTo = process.env.DEFAULT_REMINDER_REPLY_TO ?? recipientEmail;

      if (!recipientEmail || !replyTo) {
        this.logger.warn({
          event: 'reminder_skipped_missing_recipient',
          tenantId: caseRecord.tenantId,
          caseRef: caseRecord.caseRef
        });
        continue;
      }

      const sendAt = this.computeReminderTime(next.dueDate);
      const existing = await prisma.communication.findMany({
        where: { tenantId: caseRecord.tenantId, caseRef: caseRecord.caseRef, templateId: 'deadline_reminder' },
        orderBy: { createdAt: 'desc' }
      });

      const hasReminderForDeadline = existing.some((item: { variables?: unknown }) => {
        const vars = (item.variables ?? {}) as Record<string, unknown>;
        return vars.deadline_name === next.name && vars.due_date === next.dueDate.toISOString();
      });

      if (hasReminderForDeadline) {
        continue;
      }

      const variables = {
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        reply_to: replyTo,
        deadline_name: next.name,
        due_date: next.dueDate.toISOString(),
        case_ref: caseRecord.caseRef
      };

      try {
        const capBlock = await this.checkCaps(caseRecord.tenantId);
        if (capBlock) {
          await this.recordCapBlock({
            tenantId: caseRecord.tenantId,
            caseId: caseRecord.id,
            caseRef: caseRecord.caseRef,
            capBlock,
            templateId: 'deadline_reminder'
          });
          continue;
        }
        const rendered = templateRegistry.render('deadline_reminder', variables);
        const communication = await prisma.communication.create({
          data: {
            tenantId: caseRecord.tenantId,
            caseId: caseRecord.id,
            caseRef: caseRecord.caseRef,
            templateId: rendered.templateId,
            templateVersion: rendered.templateVersion,
            recipient: variables.recipient_email,
            variables,
            subject: rendered.subject,
            body: rendered.body,
            direction: CommunicationDirection.OUTBOUND,
            channel: CommunicationChannel.EMAIL,
            status: 'pending_auto',
            sendAt
          }
        });

        await prisma.caseEvent.create({
          data: {
            tenantId: caseRecord.tenantId,
            caseId: caseRecord.id,
            caseRef: caseRecord.caseRef,
            type: 'DEADLINE_REMINDER_SCHEDULED',
            payload: {
              deadlineName: next.name,
              dueDate: next.dueDate.toISOString(),
              sendAt: sendAt.toISOString(),
              recipient: variables.recipient_email,
              communicationId: communication.id
            }
          }
        });

        await this.auditEngine.append({
          tenantId: caseRecord.tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          eventType: 'DEADLINE_REMINDER_SCHEDULED',
          actor: 'system',
          payload: {
            deadlineName: next.name,
            dueDate: next.dueDate.toISOString(),
            sendAt: sendAt.toISOString(),
            recipient: variables.recipient_email
          }
        });

        this.logger.log({
          event: 'deadline_reminder_scheduled',
          tenantId: caseRecord.tenantId,
          caseRef: caseRecord.caseRef,
          deadlineName: next.name,
          sendAt: sendAt.toISOString()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.error({
          event: 'deadline_reminder_failed',
          tenantId: caseRecord.tenantId,
          caseRef: caseRecord.caseRef,
          message
        });
      }
    }
  }

  private async scheduleSubmissionReminders() {
    const pending = await prisma.caseEvent.findMany({
      where: { type: 'SUBMISSION_STATUS_ENTERED', processedAt: null },
      include: { case: { include: { assignedReviewer: true } } }
    });

    type SubmissionEvent = Prisma.CaseEventGetPayload<{
      include: { case: { include: { assignedReviewer: true } } };
    }>;

    const delayDays = Number(process.env.SUBMISSION_REMINDER_DELAY_DAYS ?? DEFAULT_SUBMISSION_REMINDER_DAYS);

    for (const event of pending as SubmissionEvent[]) {
      const caseRecord = event.case;
      if (!caseRecord) {
        continue;
      }

      const recipientEmail = caseRecord.assignedReviewer?.email ?? process.env.DEFAULT_REMINDER_RECIPIENT;
      const recipientName = caseRecord.assignedReviewer?.fullName ?? 'Case team';
      const replyTo = process.env.DEFAULT_REMINDER_REPLY_TO ?? recipientEmail;

      if (!recipientEmail || !replyTo) {
        this.logger.warn({
          event: 'submission_reminder_skipped_missing_recipient',
          tenantId: caseRecord.tenantId,
          caseRef: caseRecord.caseRef
        });
        continue;
      }

      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const status = String(payload.to ?? payload.status ?? '');
      const statusLabel =
        status === CaseStatus.SUBMITTED_BY_CLIENT
          ? 'submitted by the client'
          : status === CaseStatus.SUBMITTED_BY_PARTNER
            ? 'submitted by the partner'
            : 'awaiting response';

      const scheduledAt = new Date(event.createdAt.getTime() + delayDays * DAY_MS);
      const sendAt = scheduledAt.getTime() < Date.now() ? new Date() : scheduledAt;
      const variables = {
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        reply_to: replyTo,
        case_ref: caseRecord.caseRef,
        status_label: statusLabel
      };

      try {
        const capBlock = await this.checkCaps(caseRecord.tenantId);
        if (capBlock) {
          await this.recordCapBlock({
            tenantId: caseRecord.tenantId,
            caseId: caseRecord.id,
            caseRef: caseRecord.caseRef,
            capBlock,
            templateId: 'submission_status_reminder'
          });
          continue;
        }
        const rendered = templateRegistry.render('submission_status_reminder', variables);
        const communication = await prisma.$transaction(async (tx) => {
          const created = await tx.communication.create({
            data: {
              tenantId: caseRecord.tenantId,
              caseId: caseRecord.id,
              caseRef: caseRecord.caseRef,
              templateId: rendered.templateId,
              templateVersion: rendered.templateVersion,
              recipient: variables.recipient_email,
              variables,
              subject: rendered.subject,
              body: rendered.body,
              direction: CommunicationDirection.OUTBOUND,
              channel: CommunicationChannel.EMAIL,
              status: 'pending_auto',
              sendAt
            }
          });

          await tx.caseEvent.update({
            where: { id: event.id },
            data: { processedAt: new Date() }
          });

          await tx.caseEvent.create({
            data: {
              tenantId: caseRecord.tenantId,
              caseId: caseRecord.id,
              caseRef: caseRecord.caseRef,
              type: 'SUBMISSION_REMINDER_SCHEDULED',
              payload: {
                status,
                sendAt: sendAt.toISOString(),
                recipient: variables.recipient_email,
                communicationId: created.id
              }
            }
          });

          return created;
        });

        await this.auditEngine.append({
          tenantId: caseRecord.tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          eventType: 'SUBMISSION_REMINDER_SCHEDULED',
          actor: 'system',
          payload: {
            status,
            sendAt: sendAt.toISOString(),
            recipient: variables.recipient_email,
            communicationId: communication.id
          }
        });

        this.logger.log({
          event: 'submission_reminder_scheduled',
          tenantId: caseRecord.tenantId,
          caseRef: caseRecord.caseRef,
          statusLabel,
          sendAt: sendAt.toISOString()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.error({
          event: 'submission_reminder_failed',
          tenantId: caseRecord.tenantId,
          caseRef: caseRecord.caseRef,
          message
        });
      }
    }
  }

  private async checkCaps(tenantId: string) {
    const commsCapRaw = Number(process.env.TENANT_DAILY_COMMS_CAP ?? DEFAULT_DAILY_COMMS_CAP);
    const autoCapRaw = Number(process.env.TENANT_DAILY_AUTO_REMINDERS_CAP ?? DEFAULT_DAILY_AUTO_REMINDERS_CAP);
    const commsCap = Number.isFinite(commsCapRaw) ? commsCapRaw : DEFAULT_DAILY_COMMS_CAP;
    const autoCap = Number.isFinite(autoCapRaw) ? autoCapRaw : DEFAULT_DAILY_AUTO_REMINDERS_CAP;
    const { start, end } = this.getDayWindow();

    const [commsCount, autoCount] = await Promise.all([
      prisma.communication.count({
        where: { tenantId, createdAt: { gte: start, lt: end } }
      }),
      prisma.communication.count({
        where: { tenantId, status: 'pending_auto', createdAt: { gte: start, lt: end } }
      })
    ]);

    if (commsCount >= commsCap) {
      return { capType: 'tenant_daily_comms', cap: commsCap, count: commsCount };
    }

    if (autoCount >= autoCap) {
      return { capType: 'tenant_daily_auto_reminders', cap: autoCap, count: autoCount };
    }

    return null;
  }

  private async recordCapBlock(params: {
    tenantId: string;
    caseId: string;
    caseRef: string;
    capBlock: { capType: string; cap: number; count: number };
    templateId: string;
  }) {
    const { start, end } = this.getDayWindow();
    this.logger.warn({
      event: 'reminder_blocked_cap',
      tenantId: params.tenantId,
      caseRef: params.caseRef,
      capType: params.capBlock.capType,
      cap: params.capBlock.cap,
      count: params.capBlock.count,
      templateId: params.templateId
    });

    const existing = await prisma.caseEvent.findFirst({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        type: 'REMINDER_BLOCKED_CAP',
        createdAt: { gte: start, lt: end }
      }
    });

    if (!existing) {
      await prisma.caseEvent.create({
        data: {
          tenantId: params.tenantId,
          caseId: params.caseId,
          caseRef: params.caseRef,
          type: 'REMINDER_BLOCKED_CAP',
          payload: {
            capType: params.capBlock.capType,
            cap: params.capBlock.cap,
            count: params.capBlock.count,
            templateId: params.templateId,
            blockedAt: new Date().toISOString()
          }
        }
      });
    }
  }

  private extractDeadlines(metadata: Record<string, unknown> | null): ProceduralDeadline[] {
    const procedural = (metadata ?? {}) as { procedural?: { deadlines?: unknown } };
    const rawDeadlines = procedural.procedural?.deadlines;
    if (!Array.isArray(rawDeadlines)) return [];

    return rawDeadlines
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const dueDateValue = record.dueDate ?? record.due_date;
        const parsed =
          typeof dueDateValue === 'string' || dueDateValue instanceof Date ? new Date(dueDateValue) : null;
        if (!parsed || Number.isNaN(parsed.getTime())) {
          return null;
        }
        const name = typeof record.name === 'string' ? record.name : 'deadline';
        return { name, dueDate: parsed };
      })
      .filter((value): value is ProceduralDeadline => Boolean(value));
  }

  private pickNextDeadline(deadlines: ProceduralDeadline[]): ProceduralDeadline | null {
    const now = new Date();
    const upcoming = deadlines.filter((item) => item.dueDate.getTime() >= now.getTime());
    if (upcoming.length === 0) {
      return null;
    }
    return upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  }

  private computeReminderTime(dueDate: Date) {
    const threeDaysBefore = new Date(dueDate.getTime() - 3 * DAY_MS);
    const now = new Date();
    if (threeDaysBefore.getTime() < now.getTime()) {
      return now;
    }
    return threeDaysBefore;
  }

  private getDayWindow(date = new Date()) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const end = new Date(start.getTime() + DAY_MS);
    return { start, end };
  }
}
