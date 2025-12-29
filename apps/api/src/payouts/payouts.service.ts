import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, FeeAgreement, Prisma, TierLevel } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { prisma } from '../prisma/prisma.client';
import { FeeCalculatorService } from './fee-calculator.service';

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
  };
};

const STATE_CAPS: Record<string, number> = {
  CA: 1_250_000, // $12,500
  NY: 900_000, // $9,000
  TX: 750_000 // $7,500
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

  private async resolveAgreement(
    tenantId: string,
    tierBand: 'TIER_A' | 'TIER_B' | 'TIER_C',
    stateCode?: string,
    contractRef?: string | null
  ): Promise<FeeAgreement | null> {
    const agreements = await prisma.feeAgreement.findMany({
      where: {
        tenantId,
        ...(stateCode ? { stateCode } : {}),
        ...(contractRef ? { contractRef } : {})
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });

    const orderedTiers: TierLevel[] = [TierLevel.LOW, TierLevel.MEDIUM, TierLevel.HIGH, TierLevel.ENTERPRISE];
    const tierIndex = tierBand === 'TIER_A' ? 0 : tierBand === 'TIER_B' ? 1 : 2;
    const tierValue = orderedTiers[tierIndex];

    const match = agreements.find((agreement) => {
      const minIdx = orderedTiers.indexOf(agreement.tierMin);
      const maxIdx = orderedTiers.indexOf(agreement.tierMax);
      const targetIdx = orderedTiers.indexOf(tierValue);
      return targetIdx >= minIdx && targetIdx <= maxIdx;
    });

    return match ?? null;
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

  async confirmPayout(params: {
    tenantId: string;
    actorId: string;
    caseRef: string;
    amountCents: number;
    currency?: string;
    reference?: string;
    evidenceFile?: Express.Multer.File | null;
    note?: string;
    contractRef?: string | null;
    closeCase?: boolean;
  }): Promise<ConfirmPayoutResponse> {
    if (!params.amountCents || params.amountCents <= 0) {
      throw new BadRequestException('A payout amount is required to confirm payout');
    }
    if (!params.evidenceFile) {
      throw new BadRequestException('Evidence upload is required to confirm payout');
    }

    const caseRecord = await this.findCaseOrThrow(params.tenantId, params.caseRef);
    const tierBand = this.feeCalculator.mapTierLevelToBand(caseRecord.tierConfirmed ?? caseRecord.tierSuggested);
    const jurisdictionState = (caseRecord.metadata as any)?.jurisdiction?.state as string | undefined;
    const contractMetadata = (caseRecord.metadata as any)?.b2bContract ?? (caseRecord.metadata as any)?.b2b_contract;
    const contractRateBps: number | undefined = contractMetadata?.rate_bps ?? contractMetadata?.rateBps;
    const contractRef = params.contractRef ?? contractMetadata?.contract_ref ?? contractMetadata?.contractRef;

    const agreement = await this.resolveAgreement(params.tenantId, tierBand, jurisdictionState, contractRef ?? null);
    const fee = this.feeCalculator.calculate({
      amountCents: params.amountCents,
      tierBand,
      stateCode: jurisdictionState,
      agreement,
      contractRateBps: contractRateBps ?? undefined,
      b2bRateBps: agreement?.b2bOverride ?? undefined,
      minimumFeeCents: agreement?.minFeeCents ?? undefined,
      stateCaps: STATE_CAPS
    });

    const evidenceKey = params.evidenceFile
      ? this.buildEvidenceKey(caseRecord.caseRef, params.evidenceFile.originalname)
      : null;
    const persistedEvidence = params.evidenceFile
      ? await this.persistEvidence(evidenceKey as string, params.evidenceFile.buffer)
      : null;

    const { payout, invoice } = await prisma.$transaction(async (tx) => {
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
            contractRef: contractRef ?? null,
            stateCap: jurisdictionState ? STATE_CAPS[jurisdictionState] ?? null : null,
            agreementId: agreement?.id ?? null,
            evidenceSha256: persistedEvidence?.sha256 ?? null
          }
        },
        include: payoutWithCaseArgs.include
      });

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
            rationale: fee.rationale
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

      return { payout: payoutRecord, invoice: invoiceRecord };
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
        feeCents: fee.feeCents,
        rateBps: fee.appliedRateBps,
        capApplied: fee.appliedCapCents ?? null,
        minApplied: fee.appliedMinCents ?? null,
        state: jurisdictionState ?? null,
        contractRef: contractRef ?? null,
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
        sha256: persistedEvidence?.sha256 ?? null
      }
    };
  }
}
