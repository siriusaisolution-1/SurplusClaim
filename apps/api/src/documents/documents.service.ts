import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { prisma } from '../prisma/prisma.client';
import { RulesService } from '../rules/rules.service';
import { LegalSafetyService } from '../safety/legal-safety.service';
import { validateFileInput } from './upload.config';

export interface DocumentUploadResult {
  document: any;
  checklist: any;
}

export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly auditService: AuditService,
    private readonly rulesService: RulesService,
    private readonly legalSafety: LegalSafetyService
  ) {}

  private buildObjectKey(caseRef: string, originalName: string) {
    const safeName = originalName.replace(/\s+/g, '-').toLowerCase();
    const timestamp = Date.now();
    return path.join(caseRef, `${timestamp}-${safeName}`);
  }

  private sha256(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private async persistFile(objectKey: string, buffer: Buffer) {
    const targetPath = path.join(process.cwd(), 'services', 'uploads', objectKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
    return targetPath;
  }

  private async findCaseOrThrow(tenantId: string, caseRef: string) {
    const caseRecord = await prisma.case.findFirst({ where: { tenantId, caseRef } });
    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }
    return caseRecord;
  }

  private getAllowedDocTypes(caseRecord: any) {
    const jurisdiction = (caseRecord.metadata as any)?.jurisdiction;
    if (!jurisdiction?.state || !jurisdiction?.county_code) {
      return [] as string[];
    }

    try {
      const checklist = this.rulesService.buildChecklist({
        case_ref: caseRecord.caseRef,
        state: jurisdiction.state,
        county_code: jurisdiction.county_code
      });
      return checklist.items.filter((item) => item.type === 'document').map((item) => item.id);
    } catch (err) {
      return [] as string[];
    }
  }

  private inferDocTypeFromRules(caseRecord: any, originalName: string, allowedDocTypes: string[]) {
    const jurisdiction = (caseRecord.metadata as any)?.jurisdiction;
    if (!jurisdiction?.state || !jurisdiction?.county_code) {
      return { docType: null, confidence: null };
    }

    try {
      const checklist = this.rulesService.buildChecklist({
        case_ref: caseRecord.caseRef,
        state: jurisdiction.state,
        county_code: jurisdiction.county_code
      });
      const docs = checklist.items.filter((item) => item.type === 'document');
      const lowerName = originalName.toLowerCase();
      const match = docs.find(
        (item) => lowerName.includes(item.id.toLowerCase()) || lowerName.includes(item.title.toLowerCase())
      );
      if (match) {
        return allowedDocTypes.includes(match.id)
          ? { docType: match.id, confidence: 0.68 }
          : { docType: null, confidence: null };
      }
    } catch (err) {
      return { docType: null, confidence: null };
    }

    return { docType: null, confidence: null };
  }

  private documentMatches(doc: any, requiredId: string) {
    const label = (doc.docType ?? doc.aiDocType ?? '').toString().toLowerCase();
    return label === requiredId.toLowerCase();
  }

  private async buildChecklistProgress(caseRecord: any, documents?: any[]) {
    const jurisdiction = (caseRecord.metadata as any)?.jurisdiction;
    if (!jurisdiction?.state || !jurisdiction?.county_code) {
      return null;
    }

    const checklist = this.rulesService.buildChecklist({
      case_ref: caseRecord.caseRef,
      state: jurisdiction.state,
      county_code: jurisdiction.county_code
    });

    const docs =
      documents ??
      (await prisma.document.findMany({ where: { tenantId: caseRecord.tenantId, caseId: caseRecord.id } }));

    const completedItems = checklist.items.map((item) => {
      if (item.type === 'document') {
        return { ...item, completed: docs.some((doc) => this.documentMatches(doc, item.id) && doc.status !== 'REJECTED') };
      }
      return { ...item, completed: false };
    });

    return { ...checklist, items: completedItems };
  }

  async listDocuments(tenantId: string, caseRef: string) {
    const caseRecord = await this.findCaseOrThrow(tenantId, caseRef);
    const documents = await prisma.document.findMany({
      where: { tenantId, caseId: caseRecord.id },
      orderBy: { createdAt: 'desc' }
    });

    const checklist = await this.buildChecklistProgress(caseRecord, documents);

    return { documents, checklist };
  }

  async uploadDocument(params: {
    tenantId: string;
    actorId: string;
    caseRef: string;
    file: Express.Multer.File;
    docType?: string;
  }): Promise<DocumentUploadResult> {
    validateFileInput(params.file);

    const caseRecord = await this.findCaseOrThrow(params.tenantId, params.caseRef);
    const objectKey = this.buildObjectKey(caseRecord.caseRef, params.file.originalname);
    const allowedDocTypes = this.getAllowedDocTypes(caseRecord);
    const providedDocType = params.docType
      ? this.legalSafety.validateDocType(params.docType, allowedDocTypes)
      : undefined;

    await this.persistFile(objectKey, params.file.buffer);
    const hash = this.sha256(params.file.buffer);
    const aiGuess = this.inferDocTypeFromRules(caseRecord, params.file.originalname, allowedDocTypes);

    const document = await prisma.document.create({
      data: {
        tenantId: params.tenantId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        objectKey,
        originalFilename: params.file.originalname,
        sha256: hash,
        docType: providedDocType ?? aiGuess.docType,
        aiDocType: aiGuess.docType,
        aiConfidence: aiGuess.confidence,
        status: 'PENDING'
      }
    });

    await prisma.caseEvent.create({
      data: {
        tenantId: params.tenantId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        type: 'DOCUMENT_UPLOADED',
        payload: {
          documentId: document.id,
          objectKey: document.objectKey,
          fileName: document.originalFilename,
          sha256: document.sha256,
          docType: document.docType ?? null
        }
      }
    });

    await this.auditService.logAction({
      tenantId: params.tenantId,
      actorId: params.actorId,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      action: 'DOCUMENT_UPLOADED',
      metadata: {
        documentId: document.id,
        objectKey: document.objectKey,
        sha256: document.sha256,
        docType: document.docType ?? null,
        aiDocType: document.aiDocType ?? null
      }
    });

    const checklist = await this.buildChecklistProgress(caseRecord);

    return { document, checklist };
  }

  async reviewDocument(params: {
    tenantId: string;
    actorId: string;
    caseRef: string;
    documentId: string;
    status: DocumentStatus;
    note?: string;
    docType?: string;
  }) {
    const document = await prisma.document.findFirst({
      where: { id: params.documentId, tenantId: params.tenantId, caseRef: params.caseRef }
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const caseRecord = await this.findCaseOrThrow(params.tenantId, params.caseRef);
    const allowedDocTypes = this.getAllowedDocTypes(caseRecord);
    const updatedDocType = params.docType
      ? this.legalSafety.validateDocType(params.docType, allowedDocTypes)
      : undefined;

    const updated = await prisma.document.update({
      where: { id: document.id },
      data: {
        status: params.status,
        reviewNote: params.note ?? null,
        reviewerId: params.actorId,
        reviewedAt: new Date(),
        ...(updatedDocType ? { docType: updatedDocType } : {})
      }
    });

    await prisma.caseEvent.create({
      data: {
        tenantId: params.tenantId,
        caseId: document.caseId,
        caseRef: document.caseRef,
        type: 'DOCUMENT_REVIEWED',
        payload: {
          documentId: document.id,
          status: params.status,
          note: params.note ?? null,
          docType: params.docType ?? updated.docType ?? updated.aiDocType ?? null
        }
      }
    });

    await this.auditService.logAction({
      tenantId: params.tenantId,
      actorId: params.actorId,
      caseId: document.caseId,
      caseRef: document.caseRef,
      action: 'DOCUMENT_REVIEWED',
      metadata: {
        documentId: document.id,
        status: params.status,
        note: params.note ?? null,
        docType: params.docType ?? updated.docType ?? updated.aiDocType ?? null
      }
    });

    const caseRecordAfterReview = await this.findCaseOrThrow(params.tenantId, params.caseRef);
    const checklist = await this.buildChecklistProgress(caseRecordAfterReview);
    return { document: updated, checklist };
  }

  async getChecklistProgress(tenantId: string, caseRef: string) {
    const caseRecord = await this.findCaseOrThrow(tenantId, caseRef);
    return this.buildChecklistProgress(caseRecord);
  }

  async mergeChecklistWithDocuments(tenantId: string, caseRef: string, items: any[]) {
    const caseRecord = await this.findCaseOrThrow(tenantId, caseRef);
    const documents = await prisma.document.findMany({ where: { tenantId, caseId: caseRecord.id } });

    return items.map((item) => {
      if (item.type === 'document') {
        return {
          ...item,
          completed: documents.some((doc) => this.documentMatches(doc, item.id) && doc.status !== 'REJECTED')
        };
      }
      return { ...item, completed: false };
    });
  }
}
