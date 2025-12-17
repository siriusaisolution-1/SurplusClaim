import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditEngine } from '@surplus/audit';
import { templateRegistry } from '@surplus/shared';
import { CaseStatus, CommunicationChannel, CommunicationDirection } from '@prisma/client';

import { prisma } from '../prisma.client';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCAN_INTERVAL_MS = DAY_MS;

type ProceduralDeadline = { name: string; dueDate: Date };

@Injectable()
export class ReminderWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderWorkerService.name);
  private readonly auditEngine = new AuditEngine(prisma);
  private timer?: NodeJS.Timeout;

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
    const cases = await prisma.case.findMany({
      where: {
        status: { notIn: [CaseStatus.CLOSED, CaseStatus.PAYOUT_CONFIRMED] },
        metadata: { not: null }
      },
      include: { assignedReviewer: true }
    });

    for (const caseRecord of cases) {
      const deadlines = this.extractDeadlines(caseRecord.metadata as Record<string, unknown> | null);
      const next = this.pickNextDeadline(deadlines);
      if (!next) {
        continue;
      }

      const recipientEmail = caseRecord.assignedReviewer?.email ?? process.env.DEFAULT_REMINDER_RECIPIENT;
      const recipientName = caseRecord.assignedReviewer?.fullName ?? 'Case team';
      const replyTo = process.env.DEFAULT_REMINDER_REPLY_TO ?? recipientEmail;

      if (!recipientEmail || !replyTo) {
        this.logger.warn(`Skipping reminder for ${caseRecord.caseRef} because recipient or reply-to is missing`);
        continue;
      }

      const sendAt = this.computeReminderTime(next.dueDate);
      const existing = await prisma.communication.findMany({
        where: { tenantId: caseRecord.tenantId, caseRef: caseRecord.caseRef, templateId: 'deadline_reminder' },
        orderBy: { createdAt: 'desc' }
      });

      const hasReminderForDeadline = existing.some((item) => {
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

        this.logger.log(`Scheduled deadline reminder for ${caseRecord.caseRef} (${next.name})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.error(`Failed to schedule reminder for ${caseRecord.caseRef}: ${message}`);
      }
    }
  }

  private extractDeadlines(metadata: Record<string, unknown> | null): ProceduralDeadline[] {
    if (!metadata) return [];
    const rawDeadlines = (metadata as any)?.procedural?.deadlines ?? [];
    if (!Array.isArray(rawDeadlines)) return [];

    return rawDeadlines
      .map((item) => {
        const dueDateValue = (item as any).dueDate ?? (item as any).due_date;
        const parsed = dueDateValue ? new Date(dueDateValue) : null;
        if (!parsed || Number.isNaN(parsed.getTime())) {
          return null;
        }
        return { name: (item as any).name ?? 'deadline', dueDate: parsed } as ProceduralDeadline;
      })
      .filter(Boolean) as ProceduralDeadline[];
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
}

