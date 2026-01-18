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
  let droppedLegalExecutionNotNull = false;

  try {
    const attorney = await prisma.attorney.create({
      data: { tenantId: tenant.id, fullName: 'Ada Counsel', email: 'ada@example.com' }
    });

    const submissionCase = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-SUBMISSION',
        status: CaseStatus.PACKAGE_READY,
        tierSuggested: TierLevel.LOW
      }
    });

    const submittedByClient = await casesService.transitionCase(
      tenant.id,
      actor.id,
      submissionCase.caseRef,
      { toState: CaseStatus.SUBMITTED_BY_CLIENT }
    );

    assert.strictEqual(submittedByClient.status, CaseStatus.SUBMITTED_BY_CLIENT);

    const awaitingResponse = await casesService.transitionCase(
      tenant.id,
      actor.id,
      submissionCase.caseRef,
      { toState: CaseStatus.AWAITING_RESPONSE }
    );

    assert.strictEqual(awaitingResponse.status, CaseStatus.AWAITING_RESPONSE);

    const caseWithoutAttorney = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-1',
        status: CaseStatus.AWAITING_RESPONSE,
        tierSuggested: TierLevel.LOW,
        legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED,
        expectedPayoutWindow: '2030-01-01T00:00:00.000Z',
        closureConfirmationRequired: true
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: caseWithoutAttorney.id,
        caseRef: caseWithoutAttorney.caseRef,
        amountCents: 1234,
        currency: 'USD',
        status: 'PENDING',
        reference: 'evidence-missing-attorney',
        evidenceKey: 'object-key-payout',
        metadata: { evidenceSha256: 'hash-123' }
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, caseWithoutAttorney.caseRef, {
          toState: CaseStatus.PAYOUT_CONFIRMED
        }),
      (error) => error instanceof BadRequestException
    );

    await prisma.$executeRawUnsafe('ALTER TABLE "Case" ALTER COLUMN "legalExecutionMode" DROP NOT NULL;');
    droppedLegalExecutionNotNull = true;
    const caseWithoutLegalExecution = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-NO-LEGAL',
        status: CaseStatus.AWAITING_RESPONSE,
        tierSuggested: TierLevel.LOW,
        legalExecutionMode: LegalExecutionMode.OPS_DIRECT,
        expectedPayoutWindow: '2030-01-01T00:00:00.000Z',
        closureConfirmationRequired: true
      }
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "Case" SET "legalExecutionMode" = NULL WHERE "id" = '${caseWithoutLegalExecution.id}';`
    );

    await assert.doesNotReject(async () => {
      await casesService.findByCaseRef(tenant.id, caseWithoutLegalExecution.caseRef);
    });

    const fetchedWithoutLegalExecution = await casesService.findByCaseRef(
      tenant.id,
      caseWithoutLegalExecution.caseRef
    );
    assert.strictEqual(fetchedWithoutLegalExecution?.caseRef, caseWithoutLegalExecution.caseRef);

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: caseWithoutLegalExecution.id,
        caseRef: caseWithoutLegalExecution.caseRef,
        amountCents: 1234,
        currency: 'USD',
        status: 'PENDING',
        reference: 'evidence-missing-legal',
        evidenceKey: 'object-key-payout',
        metadata: { evidenceSha256: 'hash-123' }
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, caseWithoutLegalExecution.caseRef, {
          toState: CaseStatus.PAYOUT_CONFIRMED
        }),
      (error) => error instanceof BadRequestException
    );

    await prisma.case.update({
      where: { id: caseWithoutLegalExecution.id },
      data: { legalExecutionMode: LegalExecutionMode.OPS_DIRECT }
    });
    await prisma.$executeRawUnsafe('ALTER TABLE "Case" ALTER COLUMN "legalExecutionMode" SET NOT NULL;');
    droppedLegalExecutionNotNull = false;

    const caseWithoutEvidence = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-NO-EVIDENCE',
        status: CaseStatus.AWAITING_RESPONSE,
        tierSuggested: TierLevel.LOW,
        legalExecutionMode: LegalExecutionMode.OPS_DIRECT,
        expectedPayoutWindow: '2030-01-01T00:00:00.000Z',
        closureConfirmationRequired: true
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, caseWithoutEvidence.caseRef, {
          toState: CaseStatus.PAYOUT_CONFIRMED
        }),
      (error) => error instanceof BadRequestException
    );

    const caseWithAttorney = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-2',
        status: CaseStatus.AWAITING_RESPONSE,
        tierSuggested: TierLevel.MEDIUM,
        assignedAttorneyId: attorney.id,
        legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED,
        expectedPayoutWindow: '2030-01-01T00:00:00.000Z',
        closureConfirmationRequired: true
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: caseWithAttorney.id,
        caseRef: caseWithAttorney.caseRef,
        amountCents: 1234,
        currency: 'USD',
        status: 'PENDING',
        reference: 'evidence-payout',
        evidenceKey: 'object-key-payout',
        metadata: { evidenceSha256: 'hash-123' }
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
        legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED,
        closureConfirmationRequired: true
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: closureBlocked.id,
        caseRef: closureBlocked.caseRef,
        amountCents: 7500,
        currency: 'USD',
        status: 'CONFIRMED',
        reference: 'ready-to-close',
        processedAt: new Date(),
        confirmedAt: new Date(),
        confirmedBy: actor.id,
        evidenceKey: 'closure-artifact',
        feeCents: 1500,
        feeRateBps: 1000,
        metadata: { attorneyFeeCents: 3000, evidenceSha256: 'closure-hash' }
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, closureBlocked.caseRef, {
          toState: CaseStatus.CLOSED
        }),
      (error) => error instanceof BadRequestException
    );

    await casesService.confirmClosure(tenant.id, actor.id, closureBlocked.caseRef, {
      confirmed: true,
      note: 'closure confirmed'
    });

    await prisma.case.update({
      where: { id: closureBlocked.id },
      data: { assignedAttorneyId: attorney.id }
    });

    const closed = await casesService.transitionCase(tenant.id, actor.id, closureBlocked.caseRef, {
      toState: CaseStatus.CLOSED
    });

    assert.strictEqual(closed.status, CaseStatus.CLOSED);

    const missingWindowCase = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-NO-WINDOW',
        status: CaseStatus.AWAITING_RESPONSE,
        tierSuggested: TierLevel.MEDIUM,
        assignedAttorneyId: attorney.id,
        legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED,
        closureConfirmationRequired: true
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: missingWindowCase.id,
        caseRef: missingWindowCase.caseRef,
        amountCents: 1234,
        currency: 'USD',
        status: 'PENDING',
        reference: 'missing-window',
        evidenceKey: 'object-key-payout',
        metadata: { evidenceSha256: 'hash-123' }
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, missingWindowCase.caseRef, {
          toState: CaseStatus.PAYOUT_CONFIRMED
        }),
      (error) => error instanceof BadRequestException
    );

    const missingClosureRequiredCase = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-NO-CLOSURE-REQUIRED',
        status: CaseStatus.AWAITING_RESPONSE,
        tierSuggested: TierLevel.MEDIUM,
        assignedAttorneyId: attorney.id,
        legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED,
        expectedPayoutWindow: '2030-01-01T00:00:00.000Z',
        closureConfirmationRequired: false
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: missingClosureRequiredCase.id,
        caseRef: missingClosureRequiredCase.caseRef,
        amountCents: 1234,
        currency: 'USD',
        status: 'PENDING',
        reference: 'missing-closure-required',
        evidenceKey: 'object-key-payout',
        metadata: { evidenceSha256: 'hash-123' }
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, missingClosureRequiredCase.caseRef, {
          toState: CaseStatus.PAYOUT_CONFIRMED
        }),
      (error) => error instanceof BadRequestException
    );

    const overdueCase = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-OVERDUE',
        status: CaseStatus.AWAITING_RESPONSE,
        tierSuggested: TierLevel.MEDIUM,
        expectedPayoutWindow: '2020-01-01T00:00:00.000Z'
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, overdueCase.caseRef, {
          toState: CaseStatus.DOCUMENT_COLLECTION
        }),
      (error) => error instanceof BadRequestException
    );

    const pendingPayoutCase = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-PENDING',
        status: CaseStatus.PAYOUT_CONFIRMED,
        tierSuggested: TierLevel.MEDIUM,
        assignedAttorneyId: attorney.id
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: pendingPayoutCase.id,
        caseRef: pendingPayoutCase.caseRef,
        amountCents: 5000,
        currency: 'USD',
        status: 'PENDING',
        reference: 'pending-payout'
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, pendingPayoutCase.caseRef, {
          toState: CaseStatus.CLOSED
        }),
      (error) => error instanceof BadRequestException
    );

    const readyForClose = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-READY',
        status: CaseStatus.PAYOUT_CONFIRMED,
        tierSuggested: TierLevel.MEDIUM,
        assignedAttorneyId: attorney.id
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: readyForClose.id,
        caseRef: readyForClose.caseRef,
        amountCents: 10000,
        currency: 'USD',
        status: 'CONFIRMED',
        reference: 'paid',
        processedAt: new Date(),
        confirmedAt: new Date(),
        confirmedBy: actor.id,
        evidenceKey: 'object-key',
        feeCents: 1000,
        feeRateBps: 1000,
        metadata: { attorneyFeeCents: 5000, evidenceSha256: 'abc123' }
      }
    });

    const finalClosed = await casesService.transitionCase(tenant.id, actor.id, readyForClose.caseRef, {
      toState: CaseStatus.CLOSED
    });

    assert.strictEqual(finalClosed.status, CaseStatus.CLOSED);

    const requiresConfirmation = await prisma.case.create({
      data: {
        tenantId: tenant.id,
        caseRef: 'CASE-GUARD-CONFIRM',
        status: CaseStatus.PAYOUT_CONFIRMED,
        tierSuggested: TierLevel.MEDIUM,
        assignedAttorneyId: attorney.id,
        legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED,
        closureConfirmationRequired: true
      }
    });

    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        caseId: requiresConfirmation.id,
        caseRef: requiresConfirmation.caseRef,
        amountCents: 12500,
        currency: 'USD',
        status: 'CONFIRMED',
        reference: 'ready-to-close-with-confirmation',
        processedAt: new Date(),
        confirmedAt: new Date(),
        confirmedBy: actor.id,
        evidenceKey: 'confirmation-evidence',
        feeCents: 1200,
        feeRateBps: 1000,
        metadata: { attorneyFeeCents: 3000, evidenceSha256: 'hash-confirmation' }
      }
    });

    await assert.rejects(
      () =>
        casesService.transitionCase(tenant.id, actor.id, requiresConfirmation.caseRef, {
          toState: CaseStatus.CLOSED
        }),
      (error) => error instanceof BadRequestException
    );

    await prisma.caseEvent.create({
      data: {
        tenantId: tenant.id,
        caseId: requiresConfirmation.id,
        caseRef: requiresConfirmation.caseRef,
        type: 'CLOSURE_CONFIRMED',
        payload: { confirmedBy: actor.id }
      }
    });

    const confirmedClose = await casesService.transitionCase(
      tenant.id,
      actor.id,
      requiresConfirmation.caseRef,
      { toState: CaseStatus.CLOSED }
    );

    assert.strictEqual(confirmedClose.status, CaseStatus.CLOSED);

    console.log('Case transition guard tests passed');
  } finally {
    await prisma.$executeRawUnsafe(
      'UPDATE "Case" SET "legalExecutionMode" = \'ATTORNEY_REQUIRED\' WHERE "legalExecutionMode" IS NULL;'
    );
    if (droppedLegalExecutionNotNull) {
      await prisma.$executeRawUnsafe('ALTER TABLE "Case" ALTER COLUMN "legalExecutionMode" SET NOT NULL;');
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
