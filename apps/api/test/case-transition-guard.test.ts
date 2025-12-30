import assert from 'node:assert';

import { BadRequestException } from '@nestjs/common';
import { CaseStatus, LegalExecutionMode, TierLevel } from '@prisma/client';

import { hashPasswordForStorage } from '../src/auth/password.util';
import { CasesService } from '../src/cases/cases.service';
import { prisma } from '../src/prisma/prisma.client';

async function setup() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Attorney Guard Tenant' } });

  const actor = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'ops@test.local',
      fullName: 'Ops User',
      role: 'OPS',
      passwordHash: hashPasswordForStorage('Password1!')
    }
  });

  const casesService = new CasesService(
    { logAction: async () => ({}) } as any,
    { validateStructuredSuggestion: () => ({}), disclaimer: 'n/a' } as any
  );

  return { tenant, actor, casesService };
}

async function main() {
  const { tenant, actor, casesService } = await setup();

  const attorney = await prisma.attorney.create({
    data: { tenantId: tenant.id, fullName: 'Ada Counsel', email: 'ada@example.com' }
  });

  const caseWithoutAttorney = await prisma.case.create({
    data: {
      tenantId: tenant.id,
      caseRef: 'CASE-GUARD-1',
      status: CaseStatus.SUBMITTED,
      tierSuggested: TierLevel.LOW,
      legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED
    }
  });

  await assert.rejects(
    () =>
      casesService.transitionCase(tenant.id, actor.id, caseWithoutAttorney.caseRef, {
        toState: CaseStatus.PAYOUT_CONFIRMED
      }),
    (error) => error instanceof BadRequestException
  );

  const caseWithAttorney = await prisma.case.create({
    data: {
      tenantId: tenant.id,
      caseRef: 'CASE-GUARD-2',
      status: CaseStatus.SUBMITTED,
      tierSuggested: TierLevel.MEDIUM,
      assignedAttorneyId: attorney.id,
      legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED
    }
  });

  const payoutTransition = await casesService.transitionCase(
    tenant.id,
    actor.id,
    caseWithAttorney.caseRef,
    { toState: CaseStatus.PAYOUT_CONFIRMED }
  );

  assert.strictEqual(payoutTransition.status, CaseStatus.PAYOUT_CONFIRMED);

  const closureBlocked = await prisma.case.create({
    data: {
      tenantId: tenant.id,
      caseRef: 'CASE-GUARD-3',
      status: CaseStatus.PAYOUT_CONFIRMED,
      tierSuggested: TierLevel.HIGH,
      legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED
    }
  });

  await assert.rejects(
    () =>
      casesService.transitionCase(tenant.id, actor.id, closureBlocked.caseRef, {
        toState: CaseStatus.CLOSED
      }),
    (error) => error instanceof BadRequestException
  );

  await prisma.case.update({
    where: { id: closureBlocked.id },
    data: { assignedAttorneyId: attorney.id }
  });

  const closed = await casesService.transitionCase(tenant.id, actor.id, closureBlocked.caseRef, {
    toState: CaseStatus.CLOSED
  });

  assert.strictEqual(closed.status, CaseStatus.CLOSED);

  console.log('Case transition guard tests passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
