import assert from 'node:assert';

import { CaseStatus, TierLevel } from '@prisma/client';

import { hashPasswordForStorage } from '../src/auth/password.util';
import { CasesService } from '../src/cases/cases.service';
import { prisma } from '../src/prisma/prisma.client';
import { ReminderWorkerService } from '../../worker/src/reminders/reminder.worker';
import { prisma as workerPrisma } from '../../worker/src/prisma.client';

async function setup() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Submission Reminder Tenant' } });
  const reviewer = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'reviewer@test.local',
      fullName: 'Review User',
      role: 'REVIEWER',
      passwordHash: hashPasswordForStorage('Password1!')
    }
  });

  const casesService = new CasesService(
    { logAction: async () => ({}) } as any,
    { validateStructuredSuggestion: () => ({}), disclaimer: 'n/a' } as any
  );

  return { tenant, reviewer, casesService };
}

async function main() {
  const { tenant, reviewer, casesService } = await setup();

  const submissionCase = await prisma.case.create({
    data: {
      tenantId: tenant.id,
      caseRef: 'CASE-REMINDER-1',
      status: CaseStatus.PACKAGE_READY,
      tierSuggested: TierLevel.LOW,
      assignedReviewerId: reviewer.id
    }
  });

  const transitioned = await casesService.transitionCase(tenant.id, reviewer.id, submissionCase.caseRef, {
    toState: CaseStatus.SUBMITTED_BY_CLIENT
  });

  assert.strictEqual(transitioned.status, CaseStatus.SUBMITTED_BY_CLIENT);

  const statusEvent = await prisma.caseEvent.findFirst({
    where: { caseRef: submissionCase.caseRef, type: 'SUBMISSION_STATUS_ENTERED' }
  });

  assert.ok(statusEvent);

  const reminderWorker = new ReminderWorkerService();
  await (reminderWorker as any).scanAndSchedule();

  const reminder = await prisma.communication.findFirst({
    where: { caseRef: submissionCase.caseRef, templateId: 'submission_status_reminder' }
  });

  assert.ok(reminder);
  assert.ok(reminder?.subject.includes(submissionCase.caseRef));

  const processedEvent = await prisma.caseEvent.findFirst({
    where: { id: statusEvent?.id }
  });

  assert.ok(processedEvent?.processedAt);

  console.log('Submission reminder scheduling tests passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await workerPrisma.$disconnect();
  });
