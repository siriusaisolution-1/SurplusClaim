import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CaseStatus, TierLevel } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { prisma } from '../prisma/prisma.client';

export type CreateCaseInput = {
  caseRef: string;
  tierSuggested?: TierLevel;
  assignedReviewerId?: string | null;
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
};

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
  [CaseStatus.PACKAGE_READY]: [CaseStatus.SUBMITTED, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.SUBMITTED]: [CaseStatus.PAYOUT_CONFIRMED, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.PAYOUT_CONFIRMED]: [CaseStatus.CLOSED, CaseStatus.ON_HOLD, CaseStatus.ESCALATED],
  [CaseStatus.CLOSED]: [],
  [CaseStatus.ESCALATED]: [
    CaseStatus.DOCUMENT_COLLECTION,
    CaseStatus.PACKAGE_READY,
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
    CaseStatus.SUBMITTED,
    CaseStatus.PAYOUT_CONFIRMED,
    CaseStatus.ESCALATED
  ]
};

@Injectable()
export class CasesService {
  constructor(private auditService: AuditService) {}

  getAllowedTransitions(status: CaseStatus): CaseStatus[] {
    return allowedTransitions[status] ?? [];
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
    return prisma.case.findFirst({
      where: { tenantId, caseRef },
      include: { assignedReviewer: true }
    });
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
        include: { assignedReviewer: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return { total, data, page, pageSize };
  }

  async createCase(tenantId: string, actorId: string, input: CreateCaseInput) {
    const tierSuggested = input.tierSuggested ?? TierLevel.LOW;

    const existing = await prisma.case.findFirst({ where: { tenantId, caseRef: input.caseRef } });
    if (existing) {
      throw new ConflictException('Case with this reference already exists');
    }

    const createdCase = await prisma.$transaction(async (tx) => {
      const caseRecord = await tx.case.create({
        data: {
          tenantId,
          caseRef: input.caseRef,
          status: CaseStatus.DISCOVERED,
          tierSuggested,
          assignedReviewerId: input.assignedReviewerId ?? null,
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
        assignedReviewerId: input.assignedReviewerId ?? null
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
      escalates: suggestion.escalates
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

    const allowed = this.getAllowedTransitions(caseRecord.status);
    if (!allowed.includes(input.toState)) {
      throw new BadRequestException(
        `Transition from ${caseRecord.status} to ${input.toState} is not allowed`
      );
    }

    if (
      [CaseStatus.DOCUMENT_COLLECTION, CaseStatus.PACKAGE_READY].includes(input.toState) &&
      !(await prisma.consent.findFirst({
        where: { tenantId, caseRef, revokedAt: null }
      }))
    ) {
      throw new BadRequestException('Cannot proceed without a signed consent on file');
    }

    const updatedCase = await prisma.$transaction(async (tx) => {
      const record = await tx.case.update({
        where: { id: caseRecord.id },
        data: { status: input.toState }
      });

      await tx.caseEvent.create({
        data: {
          tenantId,
          caseId: caseRecord.id,
          caseRef: caseRecord.caseRef,
          type: 'CASE_STATUS_CHANGED',
          payload: {
            from: caseRecord.status,
            to: input.toState,
            reason: input.reason ?? null
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
      action: 'CASE_TRANSITION',
      metadata: {
        from: caseRecord.status,
        to: input.toState,
        reason: input.reason ?? null
      }
    });

    return {
      ...updatedCase,
      allowedTransitions: this.getAllowedTransitions(updatedCase.status)
    };
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
      allowedTransitions: this.getAllowedTransitions(caseRecord.status)
    };
  }
}
