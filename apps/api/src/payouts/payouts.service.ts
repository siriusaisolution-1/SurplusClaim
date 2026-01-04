import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { prisma } from '../prisma/prisma.client';
import { FeeCalculatorService } from './fee-calculator.service';
import { assertPayoutConfirmable } from './payout-confirmation.guard';

const payoutWithCaseArgs = Prisma.validator<Prisma.PayoutDefaultArgs>()({
  include: { case: true }
});

type PayoutWithCase = Prisma.PayoutGetPayload<typeof payoutWithCaseArgs>;

const invoiceWithCaseArgs = Prisma.validator<Prisma.InvoiceDefaultArgs>()({
  include: { case: true }
});

type InvoiceWithCase = Prisma.InvoiceGetPayload<typeof invoiceWithCaseArgs>;

type PayoutListResponse = {
  payouts: PayoutWithCase[];
  invoices: InvoiceWithCase[];
  latestPayout: PayoutWithCase | null;
  latestInvoice: InvoiceWithCase | null;
};

type ConfirmPayoutResponse = {
  payout: PayoutWithCase;
  invoice: InvoiceWithCase;
  fee: ReturnType<FeeCalculatorService['calculate']>;
  status: CaseStatus;
  evidence: {
    objectKey: string | null;
    sha256: string | null;
    artifactId?: string | null;
  };
};

@Injectable()
export class PayoutsService {
  constructor(
    private readonly auditService: AuditService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly casesService: CasesService
  ) {}

  private buildEvidenceKey(caseRef: string, filename: string) {
    const safeName = filename.replace(/\s+/g, '-').toLowerCase();
    const timestamp = Date.now();
    return path.join(caseRef, 'payouts', `${timestamp}-${safeName}`);
  }

  private async persistEvidence(objectKey: string, buffer: Buffer) {
    const targetPath = path.join(process.cwd(), 'services', 'uploads', objectKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { targetPath, sha256 };
  }

  private async findCaseOrThrow(tenantId: string, caseRef: string) {
    const caseRecord = await prisma.case.findFirst({ where: { tenantId, caseRef } });
    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }
    return caseRecord;
  }

  async listForCase(tenantId: string, caseRef: string): Promise<PayoutListResponse> {
    const caseRecord = await this.findCaseOrThrow(tenantId, caseRef);
    const payouts = await prisma.payout.findMany({
      where: { tenantId, caseId: caseRecord.id },
      include: payoutWithCaseArgs.include,
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }]
    });
    const invoices = await prisma.invoice.findMany({
      where: { tenantId, caseId: caseRecord.id },
      include: invoiceWithCaseArgs.include,
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }]
    });

    return {
      payouts,
      invoices,
      latestPayout: payouts[0] ?? null,
      latestInvoice: invoices[0] ?? null
    };
  }

  async uploadEvidence(params: {
    tenantId: string;
    actorId: string;
    caseRef: string;
    evidenceFile?: Express.Multer.File | null;
    note?: string;
  }) {
    if (!params.evidenceFile) {
      throw new BadRequestException('Evidence file is required');
    }

    const caseRecord = await this.findCaseOrThrow(params.tenantId, params.caseRef);
    const payout = await prisma.payout.findFirst({
      where: { tenantId: params.tenantId, caseId: caseRecord.id },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }]
    });

    if (!payout) {
      throw new BadRequestException('No payout found to attach evidence to');
    }

    const evidenceKey = this.buildEvidenceKey(caseRecord.caseRef, params.evidenceFile.originalname);
    const persistedEvidence = await this.persistEvidence(evidenceKey, params.evidenceFile.buffer);

    const artifact = await prisma.artifact.create({
      data: {
        tenantId: params.tenantId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        objectKey: evidenceKey,
        sha256: persistedEvidence.sha256,
        source: 'payout_confirmation'
      }
    });

    if (artifact) {
      await this.auditService.logAction({
        tenantId: params.tenantId,
        actorId: params.actorId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        action: 'PAYOUT_EVIDENCE_CHAINED',
          metadata: {
            payoutId: payout.id,
            artifactId: artifact.id,
            evidenceKey,
            sha256: (persistedEvidence as any)?.sha256 ?? null
          }
      });
    }

    await this.auditService.logAction({
      tenantId: params.tenantId,
      actorId: params.actorId,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      action: 'PAYOUT_EVIDENCE_UPLOADED',
      metadata: {
        artifactId: artifact.id,
        evidenceKey,
        sha256: persistedEvidence.sha256,
        note: params.note ?? null
      }
    });

    return { objectKey: evidenceKey, sha256: persistedEvidence.sha256, artifactId: artifact.id };
  }

  async confirmPayout(params: {
    tenantId: string;
    actorId: string;
    caseRef: string;
    amountCents: number;
    attorneyFeeCents: number;
    currency?: string;
    reference?: string;
    evidenceFile?: Express.Multer.File | null;
    note?: string;
    closeCase?: boolean;
  }): Promise<ConfirmPayoutResponse> {
    if (!params.amountCents || params.amountCents <= 0) {
      throw new BadRequestException('A payout amount is required to confirm payout');
    }
    if (!params.attorneyFeeCents || params.attorneyFeeCents <= 0) {
      throw new BadRequestException('An attorney fee amount is required to confirm payout');
    }
    if (!params.evidenceFile) {
      throw new BadRequestException('Trust disbursement evidence upload is required to confirm payout');
    }

    const caseRecord = await this.findCaseOrThrow(params.tenantId, params.caseRef);
    assertPayoutConfirmable({
      legalExecutionMode: caseRecord.legalExecutionMode,
      assignedAttorneyId: caseRecord.assignedAttorneyId,
      evidence: params.evidenceFile ? { evidenceKey: 'uploaded' } : null
    });
    const fee = this.feeCalculator.calculate({ attorneyFeeCents: params.attorneyFeeCents });

    const evidenceKey = params.evidenceFile
      ? this.buildEvidenceKey(caseRecord.caseRef, params.evidenceFile.originalname)
      : null;
    const persistedEvidence = params.evidenceFile
      ? await this.persistEvidence(evidenceKey as string, params.evidenceFile.buffer)
      : null;

    const { payout, invoice, artifact } = await prisma.$transaction(async (tx) => {
      const payoutRecord = await tx.payout.create({
        data: {
          tenantId: params.tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          amountCents: params.amountCents,
          currency: params.currency ?? 'USD',
          status: 'CONFIRMED',
          reference: params.reference ?? null,
          processedAt: new Date(),
          confirmedAt: new Date(),
          confirmedBy: params.actorId,
          evidenceKey,
          feeCents: fee.feeCents,
          feeRateBps: fee.appliedRateBps,
          metadata: {
            note: params.note ?? null,
            feeRationale: fee.rationale,
            attorneyFeeCents: params.attorneyFeeCents,
            evidenceSha256: persistedEvidence?.sha256 ?? null
          }
        },
        include: payoutWithCaseArgs.include
      });

      const artifactRecord = persistedEvidence
        ? await tx.artifact.create({
            data: {
              tenantId: params.tenantId,
              caseId: caseRecord.id,
              caseRef: caseRecord.caseRef,
              objectKey: evidenceKey as string,
              sha256: persistedEvidence.sha256,
              source: 'payout_confirmation'
            }
          })
        : null;

      const invoiceRecord = await tx.invoice.create({
        data: {
          tenantId: params.tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          payoutId: payoutRecord.id,
          amountCents: fee.feeCents,
          feeRateBps: fee.appliedRateBps,
          currency: params.currency ?? 'USD',
          status: 'PENDING',
          metadata: {
            cap: fee.appliedCapCents ?? undefined,
            min: fee.appliedMinCents ?? undefined,
            rationale: fee.rationale,
            attorneyFeeCents: params.attorneyFeeCents
          }
        },
        include: invoiceWithCaseArgs.include
      });

      await tx.caseEvent.create({
        data: {
          tenantId: params.tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          type: 'PAYOUT_CONFIRMED',
          payload: {
            payoutId: payoutRecord.id,
            amountCents: payoutRecord.amountCents,
            feeCents: payoutRecord.feeCents,
            reference: payoutRecord.reference,
            evidenceKey: payoutRecord.evidenceKey,
            invoiceId: invoiceRecord.id
          }
        }
      });

      return { payout: payoutRecord, invoice: invoiceRecord, artifact: artifactRecord };
    });

    await this.auditService.logAction({
      tenantId: params.tenantId,
      actorId: params.actorId,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      action: 'SUCCESS_FEE_CALCULATED',
      metadata: {
        payoutId: payout.id,
        invoiceId: invoice.id,
        amountCents: params.amountCents,
        attorneyFeeCents: params.attorneyFeeCents,
        feeCents: fee.feeCents,
        rateBps: fee.appliedRateBps,
        capApplied: fee.appliedCapCents ?? null,
        minApplied: fee.appliedMinCents ?? null,
        rationale: fee.rationale
      }
    });

    let updatedStatus = caseRecord.status;
    if (caseRecord.status !== CaseStatus.PAYOUT_CONFIRMED && caseRecord.status !== CaseStatus.CLOSED) {
      const transition = await this.casesService.transitionCase(params.tenantId, params.actorId, caseRecord.caseRef, {
        toState: CaseStatus.PAYOUT_CONFIRMED,
        reason: 'Payout confirmed with invoice generated'
      });
      updatedStatus = transition.status ?? CaseStatus.PAYOUT_CONFIRMED;
    }

    if (params.closeCase && updatedStatus !== CaseStatus.CLOSED) {
      await this.casesService.transitionCase(params.tenantId, params.actorId, caseRecord.caseRef, {
        toState: CaseStatus.CLOSED,
        reason: 'Closed after payout confirmation'
      });
      updatedStatus = CaseStatus.CLOSED;
      await this.auditService.logAction({
        tenantId: params.tenantId,
        actorId: params.actorId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        action: 'CASE_CLOSED_AFTER_PAYOUT',
        metadata: { payoutId: payout.id, invoiceId: invoice.id }
      });
    }

    return {
      payout,
      invoice,
      fee,
      status: updatedStatus,
      evidence: {
        objectKey: evidenceKey,
        sha256: persistedEvidence?.sha256 ?? null,
        artifactId: artifact?.id ?? null
      }
    };
  }
}
