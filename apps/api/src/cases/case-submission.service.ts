import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { prisma } from '../prisma/prisma.client';
import { CasesService } from './cases.service';

type RecordSubmissionInput = {
  tenantId: string;
  actorId: string;
  caseRef: string;
  file?: Express.Multer.File;
  submittedAt?: string | Date;
  channel?: string;
  notes?: string;
};

@Injectable()
export class CaseSubmissionService {
  constructor(
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly casesService: CasesService
  ) {}

  async recordSubmission(input: RecordSubmissionInput) {
    if (!input.file) {
      throw new BadRequestException('Evidence file is required to mark submission');
    }

    const caseRecord = await prisma.case.findFirst({
      where: { tenantId: input.tenantId, caseRef: input.caseRef }
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    const submittedAt = input.submittedAt ? new Date(input.submittedAt) : new Date();
    if (Number.isNaN(submittedAt.getTime())) {
      throw new BadRequestException('Invalid submittedAt value');
    }

    const evidence = await this.documentsService.uploadDocument({
      tenantId: input.tenantId,
      actorId: input.actorId,
      caseRef: input.caseRef,
      file: input.file,
      docType: 'submission_evidence'
    });

    let transitionedCase = caseRecord;
    if (caseRecord.status !== CaseStatus.SUBMITTED) {
      const allowed = this.casesService.getAllowedTransitions(caseRecord.status);
      if (!allowed.includes(CaseStatus.SUBMITTED)) {
        throw new BadRequestException('Case cannot be marked submitted from the current state');
      }
      transitionedCase = await this.casesService.transitionCase(input.tenantId, input.actorId, input.caseRef, {
        toState: CaseStatus.SUBMITTED,
        reason: 'manual_submission_with_evidence'
      });
    }

    const event = await prisma.caseEvent.create({
      data: {
        tenantId: input.tenantId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        type: 'SUBMISSION_RECORDED',
        payload: {
          submittedAt: submittedAt.toISOString(),
          channel: input.channel ?? null,
          notes: input.notes ?? null,
          evidenceDocumentId: evidence.document.id,
          autoSubmitted: false
        }
      }
    });

    await this.auditService.logAction({
      tenantId: input.tenantId,
      actorId: input.actorId,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      action: 'CASE_SUBMISSION_RECORDED',
      metadata: {
        submittedAt: submittedAt.toISOString(),
        channel: input.channel ?? null,
        notes: input.notes ?? null,
        evidenceDocumentId: evidence.document.id,
        autoSubmitted: false
      }
    });

    return {
      submissionEvent: event,
      caseStatus: transitionedCase.status,
      evidence: evidence.document,
      checklist: evidence.checklist
    };
  }
}

