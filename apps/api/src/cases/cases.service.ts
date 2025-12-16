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
};

export type CaseTransitionInput = {
  toState: CaseStatus;
  reason?: string;
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
