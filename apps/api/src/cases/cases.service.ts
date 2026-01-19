// @ts-nocheck
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CaseStatus, LegalExecutionMode, Prisma, TierLevel } from '@prisma/client';
import { RulesRegistry } from '@surplus/rules';
import { generateCaseRef, parseCaseRef } from '@surplus/shared';

import { AuditService } from '../audit/audit.service';
import { prisma } from '../prisma/prisma.client';
import { LegalSafetyService } from '../safety/legal-safety.service';
import { assertPayoutConfirmable } from '../payouts/payout-confirmation.guard';

export type CreateCaseInput = {
  caseRef?: string;
  jurisdiction?: { state: string; countycode: string };
  tierSuggested?: TierLevel;
  assignedReviewerId?: string | null;
  assignedAttorneyId?: string | null;
  legalExecutionMode?: LegalExecutionMode;
  expectedPayoutWindow?: string | null;
  closureConfirmationRequired?: boolean;
  metadata?: Record<string, unknown>;
};

export type ListCasesParams = {
  status?: CaseStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  needsTriage?: boolean;
};

export type CaseTransitionInput = {
  toState: CaseStatus;
  reason?: string;
  assignedAttorneyId?: string | null;
  legalExecutionMode?: LegalExecutionMode;
  expectedPayoutWindow?: string | null;
  closureConfirmationRequired?: boolean;
};

export type ClosureConfirmationInput = {
  confirmed: true;
  note?: string;
};

type CaseLock = { code: 'PAYOUT_OVERDUE' | 'UNCONFIRMED_PAYOUT'; message: string };

type TriagedTier = 'TIER_A' | 'TIER_B' | 'TIER_C';

export type TriageSuggestInput = {
  context?: string;
  signals?: string[];
  probateFlag?: boolean;
  heirsFlag?: boolean;
  titleIssueFlag?: boolean;
};

export type TriageSuggestion = {
  tier: TriagedTier;
  mappedTierLevel: TierLevel;
  rationale: string[];
  confidence: number;
  escalates: boolean;
  signalsUsed: string[];
};

export type ConfirmTriageInput = {
  tier: TriagedTier;
  reviewerId?: string | null;
  rationale?: string[];
  notes?: string;
  partnerHandoff?: {
    partnerName: string;
    contact: string;
    summary: string;
  };
};

const tierMapping: Record<TriagedTier, { level: TierLevel; label: string }> = {
  TIER_A: { level: TierLevel.LOW, label: 'Tier A - simple' },
  TIER_B: { level: TierLevel.MEDIUM, label: 'Tier B - intermediate' },
  TIER_C: { level: TierLevel.HIGH, label: 'Tier C - escalation' }
};

const allowedTransitions: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.DISCOVERED]: [CaseStatus.TRIAGED, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.TRIAGED]: [CaseStatus.CLIENT_CONTACTED, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.CLIENT_CONTACTED]: [
    CaseStatus.CONSENT_SIGNED,
    CaseStatus.ON_HOLD,
    CaseStatus.ESCALATED
  ],
  [CaseStatus.CONSENT_SIGNED]: [CaseStatus.DOCUMENT_COLLECTION, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.DOCUMENT_COLLECTION]: [
    CaseStatus.PACKAGE_READY,
    CaseStatus.ON_HOLD,
    CaseStatus.ESCALATED
  ],
  [CaseStatus.PACKAGE_READY]: [
    CaseStatus.SUBMITTED_BY_CLIENT,
    CaseStatus.SUBMITTED_BY_PARTNER,
    CaseStatus.ON_HOLD,
    CaseStatus.ESCALATED
  ],
  [CaseStatus.SUBMITTED_BY_CLIENT]: [
    CaseStatus.AWAITING_RESPONSE,
    CaseStatus.ON_HOLD,
    CaseStatus.ESCALATED
  ],
  [CaseStatus.SUBMITTED_BY_PARTNER]: [
    CaseStatus.AWAITING_RESPONSE,
    CaseStatus.ON_HOLD,
    CaseStatus.ESCALATED
  ],
  [CaseStatus.AWAITING_RESPONSE]: [CaseStatus.PAYOUT_CONFIRMED, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.SUBMITTED]: [
    CaseStatus.AWAITING_RESPONSE,
    CaseStatus.PAYOUT_CONFIRMED,
    CaseStatus.ON_HOLD,
    CaseStatus.ESCALATED
  ],
  [CaseStatus.PAYOUT_CONFIRMED]: [CaseStatus.CLOSED, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.CLOSED]: [],
  [CaseStatus.ESCALATED]: [
    CaseStatus.DOCUMENT_COLLECTION,
    CaseStatus.PACKAGE_READY,
    CaseStatus.SUBMITTED_BY_CLIENT,
    CaseStatus.SUBMITTED_BY_PARTNER,
    CaseStatus.AWAITING_RESPONSE,
    CaseStatus.SUBMITTED,
    CaseStatus.PAYOUT_CONFIRMED,
    CaseStatus.ON_HOLD
  ],
  [CaseStatus.ON_HOLD]: [
    CaseStatus.DISCOVERED,
    CaseStatus.TRIAGED,
    CaseStatus.CLIENT_CONTACTED,
    CaseStatus.CONSENT_SIGNED,
    CaseStatus.DOCUMENT_COLLECTION,
    CaseStatus.PACKAGE_READY,
    CaseStatus.SUBMITTED_BY_CLIENT,
    CaseStatus.SUBMITTED_BY_PARTNER,
    CaseStatus.AWAITING_RESPONSE,
    CaseStatus.SUBMITTED,
    CaseStatus.PAYOUT_CONFIRMED,
    CaseStatus.ESCALATED
  ]
};

@Injectable()
export class CasesService {
  private readonly rulesRegistry = new RulesRegistry();

  constructor(private auditService: AuditService, private legalSafety: LegalSafetyService) {}

  getAllowedTransitions(status: CaseStatus): CaseStatus[] {
    return allowedTransitions[status] ?? [];
  }

  private normalizeSubmissionTarget(target: CaseStatus): CaseStatus {
    if (target === CaseStatus.SUBMITTED) {
      return CaseStatus.SUBMITTED_BY_PARTNER;
    }
    return target;
  }

  private isSubmissionEntryStatus(status: CaseStatus): boolean {
    return (
      status === CaseStatus.SUBMITTED_BY_CLIENT ||
      status === CaseStatus.SUBMITTED_BY_PARTNER ||
      status === CaseStatus.AWAITING_RESPONSE
    );
  }

  private parseExpectedPayoutDate(window?: string | null) {
    if (!window) return null;
    const parsed = new Date(window);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private async getPayoutState(tenantId: string, caseRecordId: string) {
    const latest = await prisma.payout.findFirst({
      where: { tenantId, caseId: caseRecordId },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }]
    });

    const unconfirmed = await prisma.payout.count({
      where: { tenantId, caseId: caseRecordId, status: { not: 'CONFIRMED' } }
    });

    return { latest, hasUnconfirmed: unconfirmed > 0, hasConfirmed: latest?.status === 'CONFIRMED' };
  }

  private async generateUniqueCaseRef(
    tenantId: string,
    jurisdiction: { state: string; countyCode: string }
  ): Promise<string> {
    const attempts = 5;

    for (let i = 0; i < attempts; i += 1) {
      const candidate = generateCaseRef({
        state: jurisdiction.state,
        countycode: jurisdiction.countyCode,
        date: new Date()
      });

      const existing = await prisma.case.findFirst({ where: { tenantId, caseRef: candidate } });
      if (!existing) return candidate;
    }

    throw new ConflictException('Unable to generate a unique case reference');
  }

  private async resolveCaseRef(
    tenantId: string,
    input: CreateCaseInput
  ): Promise<{ caseRef: string; jurisdiction: { state: string; countyCode: string } }> {
    if (input.caseRef) {
      const providedRef = input.caseRef.toUpperCase();
      const parsed = parseCaseRef(providedRef);
      const existing = await prisma.case.findFirst({ where: { tenantId, caseRef: providedRef } });
      if (existing) {
        throw new ConflictException('Case with this reference already exists');
      }

      return { caseRef: providedRef, jurisdiction: { state: parsed.state, countyCode: parsed.countyCode } };
    }

    if (!input.jurisdiction?.state || !input.jurisdiction?.countycode) {
      throw new BadRequestException('Provide a case reference or jurisdiction to generate one');
    }

    const normalized = {
      state: input.jurisdiction.state.toUpperCase(),
      countyCode: input.jurisdiction.countycode.toUpperCase()
    };

    const generated = await this.generateUniqueCaseRef(tenantId, normalized);
    const parsed = parseCaseRef(generated);
    return { caseRef: generated, jurisdiction: { state: parsed.state, countyCode: parsed.countyCode } };
  }

  private async resolvePayoutEvidence(
    tenantId: string,
    caseRecord: any,
    payoutRecord?: any | null
  ) {
    const payoutMetadata = (payoutRecord?.metadata ?? {}) as Record<string, unknown>;
    const evidenceSha256 = (payoutMetadata?.evidenceSha256 as string | null) ?? null;

    if (payoutRecord?.evidenceKey || evidenceSha256) {
      return {
        evidenceKey: payoutRecord?.evidenceKey ?? null,
        evidenceSha256,
        artifactId: null
      };
    }

    const payoutArtifact = await prisma.artifact.findFirst({
      where: { tenantId, caseId: caseRecord.id, source: 'payout_confirmation' }
    });

    if (payoutArtifact) {
      return {
        evidenceKey: payoutArtifact.objectKey,
        evidenceSha256: payoutArtifact.sha256,
        artifactId: payoutArtifact.id
      };
    }

    return { evidenceKey: null, evidenceSha256: null, artifactId: null };
  }

  private buildLocks(caseRecord: any, payoutState: Awaited<ReturnType<typeof this.getPayoutState>>): CaseLock[] {
    const locks: CaseLock[] = [];
    const expectedDate = this.parseExpectedPayoutDate(caseRecord.expectedPayoutWindow);

    if (expectedDate && expectedDate.getTime() < Date.now() && !payoutState.hasConfirmed) {
      locks.push({
        code: 'PAYOUT_OVERDUE',
        message: 'Expected payout window has elapsed without confirmation'
      });
    }

    if (payoutState.hasUnconfirmed) {
      locks.push({
        code: 'UNCONFIRMED_PAYOUT',
        message: 'Unconfirmed payout exists and must be resolved before closure'
      });
    }

    return locks;
  }

  async getCaseLocks(tenantId: string, caseRecord: any): Promise<CaseLock[]> {
    const payoutState = await this.getPayoutState(tenantId, caseRecord.id);
    return this.buildLocks(caseRecord, payoutState);
  }

  private extractProceduralDeadlines(metadata: Record<string, unknown> | null) {
    if (!metadata) return [] as { name: string; dueDate: Date }[];
    const deadlines = (metadata as any)?.procedural?.deadlines ?? [];
    if (!Array.isArray(deadlines)) return [] as { name: string; dueDate: Date }[];

    return deadlines
      .map((item: any) => {
        const parsed = item?.dueDate ? new Date(item.dueDate) : item?.due_date ? new Date(item.due_date) : null;
        if (!parsed || Number.isNaN(parsed.getTime())) {
          return null;
        }
        return { name: item.name ?? 'deadline', dueDate: parsed };
      })
      .filter(Boolean) as { name: string; dueDate: Date }[];
  }

  private pickNextDeadline(deadlines: { name: string; dueDate: Date }[]) {
    const now = new Date();
    const upcoming = deadlines.filter((item) => item.dueDate.getTime() >= now.getTime());
    if (upcoming.length === 0) return null;
    return upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  }

  private deriveTriageSuggestion(
    caseRecord: any,
    input: TriageSuggestInput
  ): TriageSuggestion {
    const rationale: string[] = [];
    const signalsUsed = [...(input.signals ?? [])];
    const context = input.context?.toLowerCase() ?? '';
    let hasEscalationTrigger = false;

    const escalatedSignals = ['probate', 'heir', 'heirs', 'title', 'dispute', 'estate', 'lawsuit'];
    if (input.probateFlag) {
      rationale.push('Probate flag detected');
      signalsUsed.push('probate_flag');
      hasEscalationTrigger = true;
    }
    if (input.heirsFlag) {
      rationale.push('Heirs or next-of-kin investigation required');
      signalsUsed.push('heirs_flag');
      hasEscalationTrigger = true;
    }
    if (input.titleIssueFlag) {
      rationale.push('Title issue noted by intake');
      signalsUsed.push('title_issue_flag');
      hasEscalationTrigger = true;
    }

    const metadataString = JSON.stringify(caseRecord.metadata ?? {}).toLowerCase();
    if (escalatedSignals.some((keyword) => context.includes(keyword) || metadataString.includes(keyword))) {
      rationale.push('Escalation keywords detected (probate/heirs/title dispute)');
      hasEscalationTrigger = true;
    }

    let tier: TriagedTier = 'TIER_A';
    if (hasEscalationTrigger) {
      tier = 'TIER_C';
    } else if (rationale.length >= 1) {
      tier = 'TIER_B';
    }

    const mappedTierLevel = tierMapping[tier].level;
    const confidence = tier === 'TIER_A' ? 0.58 : tier === 'TIER_B' ? 0.76 : 0.91;

    if (tier === 'TIER_A') {
      rationale.push('Defaulted to Tier A due to no escalation signals');
    } else if (tier === 'TIER_B') {
      rationale.push('Intermediate handling recommended before client contact');
    } else {
      rationale.push('Tier C requires escalation to partner');
    }

    return {
      tier,
      mappedTierLevel,
      rationale,
      confidence,
      escalates: tier === 'TIER_C',
      signalsUsed: Array.from(new Set(signalsUsed))
    };
  }

  async findByCaseRef(tenantId: string, caseRef: string) {
    try {
      const caseRecord = await prisma.case.findFirst({
        where: { tenantId, caseRef },
        include: { assignedReviewer: true, assignedAttorney: true }
      });
      if (caseRecord) {
        if (caseRecord.legalExecutionMode == null) {
          caseRecord.legalExecutionMode = LegalExecutionMode.ATTORNEY_REQUIRED;
        }
        return caseRecord;
      }
    } catch (error: any) {
      const message = error?.message ?? '';

      if (message.includes('LegalExecutionMode') && message.includes('null')) {
        const rows = await prisma.$queryRaw<
          Array<{
            id: string;
            tenantId: string;
            caseRef: string;
            status: CaseStatus;
            tierSuggested: TierLevel;
            tierConfirmed: TierLevel | null;
            assignedReviewerId: string | null;
            assignedAttorneyId: string | null;
            legalExecutionMode: LegalExecutionMode | null;
            expectedPayoutWindow: string | null;
            closureConfirmationRequired: boolean;
            metadata: Record<string, unknown> | null;
            createdAt: Date;
            updatedAt: Date;
          }>
        >(
          Prisma.sql`SELECT * FROM "Case" WHERE "tenantId" = ${tenantId}::uuid AND "caseRef" = ${caseRef} LIMIT 1`
        );

        const rawCase = rows[0];
        if (!rawCase) return null;

        const [assignedReviewer, assignedAttorney] = await Promise.all([
          rawCase.assignedReviewerId
            ? prisma.user.findUnique({ where: { id: rawCase.assignedReviewerId } })
            : Promise.resolve(null),
          rawCase.assignedAttorneyId
            ? prisma.attorney.findUnique({ where: { id: rawCase.assignedAttorneyId } })
            : Promise.resolve(null)
        ]);

        return {
          ...rawCase,
          legalExecutionMode: rawCase.legalExecutionMode ?? LegalExecutionMode.ATTORNEY_REQUIRED,
          assignedReviewer,
          assignedAttorney
        } as any;
      }

      throw error;
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        tenantId: string;
        caseRef: string;
        status: CaseStatus;
        tierSuggested: TierLevel;
        tierConfirmed: TierLevel | null;
        assignedReviewerId: string | null;
        assignedAttorneyId: string | null;
        legalExecutionMode: LegalExecutionMode | null;
        expectedPayoutWindow: string | null;
        closureConfirmationRequired: boolean;
        metadata: Record<string, unknown> | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >(
      Prisma.sql`SELECT * FROM "Case" WHERE "tenantId" = ${tenantId}::uuid AND "caseRef" = ${caseRef} LIMIT 1`
    );

    const rawCase = rows[0];
    if (!rawCase) return null;

    const [assignedReviewer, assignedAttorney] = await Promise.all([
      rawCase.assignedReviewerId
        ? prisma.user.findUnique({ where: { id: rawCase.assignedReviewerId } })
        : Promise.resolve(null),
      rawCase.assignedAttorneyId
        ? prisma.attorney.findUnique({ where: { id: rawCase.assignedAttorneyId } })
        : Promise.resolve(null)
    ]);

    return {
      ...rawCase,
      legalExecutionMode: rawCase.legalExecutionMode ?? LegalExecutionMode.ATTORNEY_REQUIRED,
      assignedReviewer,
      assignedAttorney
    } as any;
  }

  async listCases(tenantId: string, params: ListCasesParams) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 10;

    const where = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.needsTriage ? { tierConfirmed: null } : {}),
      ...(params.search
        ? { caseRef: { contains: params.search, mode: 'insensitive' as const } }
        : {})
    };

    const [total, data] = await prisma.$transaction([
      prisma.case.count({ where }),
      prisma.case.findMany({
        where,
        include: { assignedReviewer: true, assignedAttorney: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return { total, data, page, pageSize };
  }

  async createCase(tenantId: string, actorId: string, input: CreateCaseInput) {
    const tierSuggested = input.tierSuggested ?? TierLevel.LOW;

    let resolved: { caseRef: string; jurisdiction: { state: string; countyCode: string } };
    try {
      resolved = await this.resolveCaseRef(tenantId, input);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) throw error;
      throw new BadRequestException('Invalid case reference format');
    }

    const { caseRef, jurisdiction } = resolved;

    if (!this.rulesRegistry.isJurisdictionEnabled(jurisdiction.state, jurisdiction.countyCode)) {
      await this.auditService.logAction({
        tenantId,
        actorId,
        caseRef,
        action: 'CASE_CREATION_REJECTED',
        metadata: {
          reason: 'jurisdiction_not_enabled',
          state: jurisdiction.state,
          county_code: jurisdiction.countyCode
        }
      });
      throw new BadRequestException(
        `Jurisdiction ${jurisdiction.state}/${jurisdiction.countyCode} is not enabled for intake`
      );
    }

    const createdCase = await prisma.$transaction(async (tx) => {
      const caseRecord = await tx.case.create({
        data: {
          tenantId,
          caseRef,
          status: CaseStatus.DISCOVERED,
          tierSuggested,
          assignedReviewerId: input.assignedReviewerId ?? null,
          assignedAttorneyId: input.assignedAttorneyId ?? null,
          legalExecutionMode: input.legalExecutionMode ?? LegalExecutionMode.ATTORNEY_REQUIRED,
          expectedPayoutWindow: input.expectedPayoutWindow ?? null,
          closureConfirmationRequired: input.closureConfirmationRequired ?? false,
          metadata: input.metadata ?? null
        }
      });

      await tx.caseEvent.create({
        data: {
          tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          type: 'CASE_CREATED',
          payload: {
            tierSuggested,
            assignedReviewerId: input.assignedReviewerId ?? null,
            assignedAttorneyId: input.assignedAttorneyId ?? null,
            legalExecutionMode: input.legalExecutionMode ?? LegalExecutionMode.ATTORNEY_REQUIRED,
            expectedPayoutWindow: input.expectedPayoutWindow ?? null,
            closureConfirmationRequired: input.closureConfirmationRequired ?? false,
            metadata: input.metadata ?? {}
          }
        }
      });

      return caseRecord;
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: createdCase.id,
      caseRef: createdCase.caseRef,
      action: 'CASE_CREATED',
      metadata: {
        tierSuggested,
        assignedReviewerId: input.assignedReviewerId ?? null,
        assignedAttorneyId: input.assignedAttorneyId ?? null,
        legalExecutionMode: input.legalExecutionMode ?? LegalExecutionMode.ATTORNEY_REQUIRED,
        expectedPayoutWindow: input.expectedPayoutWindow ?? null,
        closureConfirmationRequired: input.closureConfirmationRequired ?? false
      }
    });

    return createdCase;
  }

  async suggestTier(
    tenantId: string,
    actorId: string,
    caseRef: string,
    input: TriageSuggestInput
  ) {
    const caseRecord = await this.findByCaseRef(tenantId, caseRef);

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }
    const suggestion = this.deriveTriageSuggestion(caseRecord, input);
    this.legalSafety.validateStructuredSuggestion(suggestion);

    const updatedCase = await prisma.$transaction(async (tx) => {
      const record = await tx.case.update({
        where: { id: caseRecord.id },
        data: { tierSuggested: suggestion.mappedTierLevel }
      });

      await tx.caseEvent.create({
        data: {
          tenantId,
          caseId: record.id,
          caseRef: record.caseRef,
          type: 'TRIAGE_SUGGESTED',
          payload: {
            tier: suggestion.tier,
            mappedTierLevel: suggestion.mappedTierLevel,
            rationale: suggestion.rationale,
            confidence: suggestion.confidence,
            signals: suggestion.signalsUsed,
            suggestedBy: 'triage-engine'
          }
        }
      });

      return record;
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: updatedCase.id,
      caseRef: updatedCase.caseRef,
      action: 'TRIAGE_SUGGESTED',
      metadata: {
        tier: suggestion.tier,
        mappedTierLevel: suggestion.mappedTierLevel,
        rationale: suggestion.rationale,
        confidence: suggestion.confidence,
        signals: suggestion.signalsUsed,
        suggestedBy: 'triage-engine'
      }
    });

    return {
      caseRef: updatedCase.caseRef,
      tierSuggested: suggestion.tier,
      mappedTierLevel: suggestion.mappedTierLevel,
      rationale: suggestion.rationale,
      confidence: suggestion.confidence,
      escalates: suggestion.escalates,
      disclaimer: this.legalSafety.disclaimer
    };
  }

  async confirmTier(
    tenantId: string,
    actorId: string,
    caseRef: string,
    input: ConfirmTriageInput
  ) {
    const tierMeta = tierMapping[input.tier];
    if (!tierMeta) {
      throw new BadRequestException('Invalid tier selection');
    }

    if (input.tier === 'TIER_C' && !input.partnerHandoff) {
      throw new BadRequestException('Partner handoff is required for Tier C escalations');
    }

    const caseRecord = await this.findByCaseRef(tenantId, caseRef);

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    const shouldEscalate = input.tier === 'TIER_C' && caseRecord.status !== CaseStatus.ESCALATED;

    const updatedCase = await prisma.$transaction(async (tx) => {
      const record = await tx.case.update({
        where: { id: caseRecord.id },
        data: {
          tierSuggested: tierMeta.level,
          tierConfirmed: tierMeta.level,
          assignedReviewerId: input.reviewerId ?? caseRecord.assignedReviewerId ?? null,
          status: shouldEscalate ? CaseStatus.ESCALATED : caseRecord.status
        },
        include: { assignedReviewer: true }
      });

      await tx.caseEvent.create({
        data: {
          tenantId,
          caseId: record.id,
          caseRef: record.caseRef,
          type: 'TRIAGE_CONFIRMED',
          payload: {
            tier: input.tier,
            mappedTierLevel: tierMeta.level,
            rationale: input.rationale ?? [],
            notes: input.notes ?? null,
            reviewerId: record.assignedReviewerId
          }
        }
      });

      if (input.tier === 'TIER_C' && input.partnerHandoff) {
        await tx.caseEvent.create({
          data: {
            tenantId,
            caseId: record.id,
            caseRef: record.caseRef,
            type: 'PARTNER_HANDOFF',
            payload: {
              ...input.partnerHandoff,
              triggeredBy: actorId,
              reason: 'Tier C escalation'
            }
          }
        });
      }

      if (shouldEscalate) {
        await tx.caseEvent.create({
          data: {
            tenantId,
            caseId: record.id,
            caseRef: record.caseRef,
            type: 'CASE_STATUS_CHANGED',
            payload: {
              from: caseRecord.status,
              to: CaseStatus.ESCALATED,
              reason: 'Tier C escalation'
            }
          }
        });
      }

      return record;
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: updatedCase.id,
      caseRef: updatedCase.caseRef,
      action: 'TRIAGE_CONFIRMED',
      metadata: {
        tier: input.tier,
        mappedTierLevel: tierMeta.level,
        rationale: input.rationale ?? [],
        notes: input.notes ?? null,
        reviewerId: updatedCase.assignedReviewerId
      }
    });

    if (input.tier === 'TIER_C' && input.partnerHandoff) {
      await this.auditService.logAction({
        tenantId,
        actorId,
        caseId: updatedCase.id,
        caseRef: updatedCase.caseRef,
        action: 'PARTNER_HANDOFF_RECORDED',
        metadata: {
          partnerName: input.partnerHandoff.partnerName,
          contact: input.partnerHandoff.contact,
          summary: input.partnerHandoff.summary,
          reason: 'Tier C escalation'
        }
      });
    }

    if (shouldEscalate) {
      await this.auditService.logAction({
        tenantId,
        actorId,
        caseId: updatedCase.id,
        caseRef: updatedCase.caseRef,
        action: 'CASE_TRANSITION',
        metadata: {
          from: caseRecord.status,
          to: CaseStatus.ESCALATED,
          reason: 'Tier C escalation'
        }
      });
    }

    return {
      case: updatedCase,
      allowedTransitions: this.getAllowedTransitions(updatedCase.status),
      escalated: shouldEscalate
    };
  }

  async transitionCase(
    tenantId: string,
    actorId: string,
    caseRef: string,
    input: CaseTransitionInput
  ) {
    const caseRecord = await this.findByCaseRef(tenantId, caseRef);

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    const normalizedToState = this.normalizeSubmissionTarget(input.toState);
    const allowed = this.getAllowedTransitions(caseRecord.status);
    if (!allowed.includes(normalizedToState)) {
      throw new BadRequestException(
        `Transition from ${caseRecord.status} to ${normalizedToState} is not allowed`
      );
    }

    if (input.legalExecutionMode && !Object.values(LegalExecutionMode).includes(input.legalExecutionMode)) {
      throw new BadRequestException('Invalid legalExecutionMode value');
    }

    const effectiveLegalExecutionMode = input.legalExecutionMode ?? caseRecord.legalExecutionMode;
    const effectiveAssignedAttorneyId =
      input.assignedAttorneyId !== undefined ? input.assignedAttorneyId : caseRecord.assignedAttorneyId;
    const effectiveExpectedPayoutWindow =
      input.expectedPayoutWindow !== undefined ? input.expectedPayoutWindow : caseRecord.expectedPayoutWindow;
    const effectiveClosureConfirmationRequired =
      input.closureConfirmationRequired !== undefined
        ? input.closureConfirmationRequired
        : caseRecord.closureConfirmationRequired;

    const payoutState = await this.getPayoutState(tenantId, caseRecord.id);
    const payoutEvidence =
      normalizedToState === CaseStatus.PAYOUT_CONFIRMED
        ? await this.resolvePayoutEvidence(tenantId, caseRecord, payoutState.latest)
        : null;
    const locks = this.buildLocks(caseRecord, payoutState);
    const lockBypassStates = [
      CaseStatus.PAYOUT_CONFIRMED,
      CaseStatus.CLOSED,
      CaseStatus.ON_HOLD,
      CaseStatus.ESCALATED
    ];

    if (locks.length > 0 && !lockBypassStates.includes(normalizedToState)) {
      throw new BadRequestException(`Case locked: ${locks[0].message}`);
    }

    if (
      [CaseStatus.DOCUMENT_COLLECTION, CaseStatus.PACKAGE_READY].includes(normalizedToState) &&
      !(await prisma.consent.findFirst({
        where: { tenantId, caseRef, revokedAt: null }
      }))
    ) {
      throw new BadRequestException('Cannot proceed without a signed consent on file');
    }

    if (
      normalizedToState === CaseStatus.CLOSED &&
      effectiveLegalExecutionMode === LegalExecutionMode.ATTORNEY_REQUIRED &&
      !effectiveAssignedAttorneyId
    ) {
      throw new BadRequestException('Attorney assignment required before payout confirmation or closure');
    }

    if (normalizedToState === CaseStatus.PAYOUT_CONFIRMED) {
      if (!effectiveExpectedPayoutWindow || effectiveExpectedPayoutWindow.trim() === '') {
        throw new BadRequestException('Expected payout window must be set before payout confirmation');
      }
      if (effectiveClosureConfirmationRequired !== true) {
        throw new BadRequestException(
          'Closure confirmation required must be set to true before payout confirmation per compliance'
        );
      }
      assertPayoutConfirmable({
        legalExecutionMode: effectiveLegalExecutionMode,
        assignedAttorneyId: effectiveAssignedAttorneyId,
        evidence: payoutEvidence
      });
    }

    if (normalizedToState === CaseStatus.CLOSED) {
      if (locks.some((lock) => lock.code === 'UNCONFIRMED_PAYOUT')) {
        throw new BadRequestException('Cannot close case while payout is still unconfirmed');
      }

      if (effectiveClosureConfirmationRequired) {
        const confirmation = await prisma.caseEvent.findFirst({
          where: { tenantId, caseRef: caseRecord.caseRef, type: 'CLOSURE_CONFIRMED' }
        });

        if (!confirmation) {
          throw new BadRequestException('Closure confirmation required before closing case');
        }
      }

      const latestPayout = payoutState.latest;
      const payoutMetadata = (latestPayout?.metadata ?? {}) as Record<string, unknown>;
      const attorneyFee = payoutMetadata?.attorneyFeeCents as number | null;
      const evidenceSha = payoutMetadata?.evidenceSha256 as string | null;

      if (!latestPayout || latestPayout.status !== 'CONFIRMED') {
        throw new BadRequestException('Payout confirmation required before closure');
      }
      if (!latestPayout.amountCents || latestPayout.amountCents <= 0) {
        throw new BadRequestException('Payout amount must be recorded before closure');
      }
      if (!latestPayout.feeCents || attorneyFee === null || attorneyFee === undefined) {
        throw new BadRequestException('Attorney fee and platform fee must be recorded before closure');
      }
      if (!latestPayout.evidenceKey || !evidenceSha) {
        throw new BadRequestException('Trust confirmation artifact required before closure');
      }
      if (!effectiveLegalExecutionMode) {
        throw new BadRequestException('Legal execution metadata must be set before closure');
      }
    }

    const updatedCase = await prisma.$transaction(async (tx) => {
      const data: any = { status: normalizedToState };

      if (input.assignedAttorneyId !== undefined) {
        data.assignedAttorneyId = input.assignedAttorneyId;
      }
      if (input.legalExecutionMode) {
        data.legalExecutionMode = input.legalExecutionMode;
      }
      if (input.expectedPayoutWindow !== undefined) {
        data.expectedPayoutWindow = input.expectedPayoutWindow;
      }
      if (input.closureConfirmationRequired !== undefined) {
        data.closureConfirmationRequired = input.closureConfirmationRequired;
      }

      const record = await tx.case.update({
        where: { id: caseRecord.id },
        data
      });

      await tx.caseEvent.create({
        data: {
          tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          type: 'CASE_STATUS_CHANGED',
          payload: {
            from: caseRecord.status,
            to: normalizedToState,
            reason: input.reason ?? null
          }
        }
      });

      if (this.isSubmissionEntryStatus(normalizedToState)) {
        await tx.caseEvent.create({
          data: {
            tenantId,
            caseId: caseRecord.id,
            caseRef: caseRecord.caseRef,
            type: 'SUBMISSION_STATUS_ENTERED',
            payload: {
              from: caseRecord.status,
              to: normalizedToState
            }
          }
        });
      }

      return record;
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: updatedCase.id,
      caseRef: updatedCase.caseRef,
      action: 'CASE_TRANSITION',
      metadata: {
        from: caseRecord.status,
        to: normalizedToState,
        reason: input.reason ?? null
      }
    });

    if (this.isSubmissionEntryStatus(normalizedToState)) {
      await this.auditService.logAction({
        tenantId,
        actorId,
        caseId: updatedCase.id,
        caseRef: updatedCase.caseRef,
        action: 'CASE_SUBMISSION_STATUS_ENTERED',
        metadata: {
          from: caseRecord.status,
          to: normalizedToState
        }
      });
    }

    return {
      ...updatedCase,
      allowedTransitions: this.getAllowedTransitions(updatedCase.status),
      locks: await this.getCaseLocks(tenantId, updatedCase)
    };
  }

  async confirmClosure(
    tenantId: string,
    actorId: string,
    caseRef: string,
    input: ClosureConfirmationInput
  ) {
    if (input.confirmed !== true) {
      throw new BadRequestException('Closure confirmation requires confirmed=true');
    }

    const caseRecord = await this.findByCaseRef(tenantId, caseRef);

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    const existing = await prisma.caseEvent.findFirst({
      where: { tenantId, caseRef, type: 'CLOSURE_CONFIRMED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    if (existing) {
      return { confirmation: existing };
    }

    const note = input.note?.trim() ? input.note.trim() : null;

    const confirmation = await prisma.caseEvent.create({
      data: {
        tenantId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        type: 'CLOSURE_CONFIRMED',
        payload: { confirmed: true, note }
      }
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      action: 'CLOSURE_CONFIRMED',
      metadata: { caseRef: caseRecord.caseRef, confirmed: true, note }
    });

    return { confirmation };
  }

  async getCaseWithTimeline(tenantId: string, caseRef: string) {
    const caseRecord = await this.findByCaseRef(tenantId, caseRef);

    if (!caseRecord) {
      return null;
    }

    const [events, auditTrail] = await Promise.all([
      prisma.caseEvent.findMany({
        where: { tenantId, caseRef },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      }),
      prisma.auditLog.findMany({
        where: { tenantId, caseRef },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5
      })
    ]);

    return {
      caseRecord,
      events,
      auditTrail,
      allowedTransitions: this.getAllowedTransitions(caseRecord.status),
      locks: await this.getCaseLocks(tenantId, caseRecord),
      reminderHistory: events
        .filter((event) =>
          [
            'DEADLINE_REMINDER_SCHEDULED',
            'DEADLINE_REMINDER_SENT',
            'SUBMISSION_REMINDER_SCHEDULED',
            'SUBMISSION_REMINDER_SENT'
          ].includes(event.type)
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      nextDeadline: this.pickNextDeadline(this.extractProceduralDeadlines(caseRecord.metadata as any))
    };
  }

  async assignAttorney(tenantId: string, actorId: string, caseRef: string, attorneyId: string | null) {
    const caseRecord = await this.findByCaseRef(tenantId, caseRef);

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    const updatedCase = await prisma.case.update({
      where: { id: caseRecord.id },
      data: { assignedAttorneyId: attorneyId }
    });

    await prisma.caseEvent.create({
      data: {
        tenantId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        type: 'ATTORNEY_ASSIGNED',
        payload: { from: caseRecord.assignedAttorneyId ?? null, to: attorneyId }
      }
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      action: 'ATTORNEY_ASSIGNED',
      metadata: { attorneyId }
    });

    return { ...updatedCase, locks: await this.getCaseLocks(tenantId, updatedCase) };
  }
}
