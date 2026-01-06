// @ts-nocheck
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Injectable, NotFoundException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import PDFDocument from 'pdfkit';

import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { findCaseByRefRaw } from '../prisma/case-lookup';
import { prisma } from '../prisma/prisma.client';

const PACKAGE_DIR = path.join(process.cwd(), 'apps', 'api', 'storage', 'packages');
const UPLOADS_DIR = path.join(process.cwd(), 'services', 'uploads');

@Injectable()
export class CasePackageService {
  constructor(
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService
  ) {
    if (!fs.existsSync(PACKAGE_DIR)) {
      fs.mkdirSync(PACKAGE_DIR, { recursive: true });
    }
  }

  private sha256(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private safeCaseRef(caseRef: string) {
    return caseRef.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private buildDocumentFileName(document: any) {
    const base = document.originalFilename?.toString().replace(/\s+/g, '-') ?? 'document';
    const label = document.docType ?? document.aiDocType ?? 'unclassified';
    return `${label}-${document.id}-${base}`;
  }

  private summarizeChecklist(checklist?: any) {
    if (!checklist) {
      return { completed: 0, total: 0, pending: [] as string[], jurisdiction: null };
    }

    const total = checklist.items.length;
    const completed = checklist.items.filter((item: any) => item.completed).length;
    const pending = checklist.items
      .filter((item: any) => !item.completed)
      .map((item: any) => item.id ?? item.title ?? 'item');

    return {
      completed,
      total,
      pending,
      jurisdiction: checklist.jurisdiction ?? null
    };
  }

  private renderFooter(doc: PDFDocument, text: string) {
    const bottom = doc.page.height - doc.page.margins.bottom + 10;
    doc
      .fontSize(8)
      .fillColor('gray')
      .text(text, doc.page.margins.left, bottom, {
        align: 'center',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right
      })
      .fillColor('black');
  }

  private generateCoverSheet(params: {
    tenantId: string;
    caseRecord: any;
    checklist?: any;
    documents: any[];
    consentOnFile: boolean;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      const footerText = `Case ${params.caseRecord.caseRef} • Tenant ${params.tenantId} • ${new Date().toISOString()}`;

      const footer = () => this.renderFooter(doc, footerText);
      doc.on('pageAdded', footer);

      doc.on('data', (chunk) => chunks.push(chunk as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      doc.fontSize(18).text('Case Package Cover Sheet', { align: 'center' });
      doc.moveDown();
      doc
        .fontSize(12)
        .text('Neutral summary for export. No legal opinions or submissions are made in this document.');
      doc.moveDown();

      doc.fontSize(12).text(`Case reference: ${params.caseRecord.caseRef}`);
      doc.text(`Tenant: ${params.tenantId}`);
      doc.text(`Current status: ${params.caseRecord.status}`);
      doc.text(`Tier suggested: ${params.caseRecord.tierSuggested}`);
      doc.text(`Tier confirmed: ${params.caseRecord.tierConfirmed ?? 'Not set'}`);
      doc.text(`Assigned reviewer: ${params.caseRecord.assignedReviewer?.email ?? 'Unassigned'}`);
      doc.text(`Consent on file: ${params.consentOnFile ? 'Yes' : 'No'}`);
      doc.text(`Last updated: ${params.caseRecord.updatedAt.toISOString()}`);
      doc.moveDown();

      const checklistStats = this.summarizeChecklist(params.checklist);
      doc.fontSize(14).text('Checklist summary');
      if (checklistStats.jurisdiction) {
        doc
          .fontSize(12)
          .text(
            `Jurisdiction: ${checklistStats.jurisdiction.state}-${checklistStats.jurisdiction.county_code}`
          );
      }
      doc.fontSize(12).text(`Completed items: ${checklistStats.completed}/${checklistStats.total}`);
      if (params.checklist?.items?.length) {
        doc.moveDown(0.5);
        params.checklist.items.forEach((item: any) => {
          const marker = item.completed ? '✓' : '○';
          doc.text(`${marker} ${item.title ?? item.id} [${item.id}]`);
        });
      }
      doc.moveDown();

      doc.fontSize(14).text('Documents included');
      if (params.documents.length === 0) {
        doc.fontSize(12).text('No documents have been uploaded yet.');
      } else {
        params.documents.forEach((document) => {
          const label = document.docType ?? document.aiDocType ?? 'Unclassified';
          doc
            .fontSize(12)
            .text(
              `- ${document.originalFilename} (${label}) [${document.status}] uploaded ${document.createdAt.toISOString()}`
            );
        });
      }

      footer();
      doc.end();
    });
  }

  private async buildPackageBuffer(params: {
    caseRecord: any;
    checklist?: any;
    documents: any[];
    consentOnFile: boolean;
    tenantId: string;
  }) {
    const zip = new AdmZip();
    const coverSheet = await this.generateCoverSheet({
      tenantId: params.tenantId,
      caseRecord: params.caseRecord,
      checklist: params.checklist,
      documents: params.documents,
      consentOnFile: params.consentOnFile
    });

    zip.addFile('cover-sheet.pdf', coverSheet);

    const metadata = {
      case: {
        caseRef: params.caseRecord.caseRef,
        tenantId: params.caseRecord.tenantId,
        status: params.caseRecord.status,
        tierSuggested: params.caseRecord.tierSuggested,
        tierConfirmed: params.caseRecord.tierConfirmed ?? null,
        assignedReviewer: params.caseRecord.assignedReviewer?.email ?? null,
        createdAt: params.caseRecord.createdAt,
        updatedAt: params.caseRecord.updatedAt,
        consentOnFile: params.consentOnFile,
        jurisdiction: (params.caseRecord.metadata as any)?.jurisdiction ?? null
      },
      checklist: params.checklist,
      documents: params.documents.map((doc) => ({
        id: doc.id,
        originalFilename: doc.originalFilename,
        objectKey: doc.objectKey,
        docType: doc.docType,
        status: doc.status,
        uploadedAt: doc.createdAt
      }))
    };

    zip.addFile('package-metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));

    params.documents.forEach((document) => {
      const filePath = path.join(UPLOADS_DIR, document.objectKey);
      if (fs.existsSync(filePath)) {
        zip.addLocalFile(filePath, 'documents', this.buildDocumentFileName(document));
      }
    });

    return zip.toBuffer();
  }

  async generatePackage(tenantId: string, actorId: string, caseRef: string) {
    const baseCase = await findCaseByRefRaw(tenantId, caseRef);
    const caseRecord = baseCase
      ? {
          ...baseCase,
          assignedReviewer: baseCase.assignedReviewerId
            ? await prisma.user.findUnique({ where: { id: baseCase.assignedReviewerId } })
            : null
        }
      : null;

    if (!caseRecord) {
      await this.auditService.logAction({
        tenantId,
        actorId,
        caseRef,
        action: 'CASE_PACKAGE_EXPORT_DENIED',
        metadata: { reason: 'case_not_found' }
      });
      throw new NotFoundException('Case not found');
    }

    const [documents, checklist, consent] = await Promise.all([
      prisma.document.findMany({
        where: { tenantId, caseId: caseRecord.id },
        orderBy: { createdAt: 'asc' }
      }),
      this.documentsService.getChecklistProgress(tenantId, caseRef).catch(() => null),
      prisma.consent.findFirst({ where: { tenantId, caseRef, revokedAt: null } })
    ]);

    const packageBuffer = await this.buildPackageBuffer({
      tenantId,
      caseRecord,
      checklist,
      documents,
      consentOnFile: Boolean(consent)
    });

    const safeRef = this.safeCaseRef(caseRef);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${safeRef}-${timestamp}-case-package.zip`;
    const objectKey = path.join('packages', filename);
    const targetPath = path.join(PACKAGE_DIR, filename);

    await fs.promises.writeFile(targetPath, packageBuffer);

    const artifact = await prisma.artifact.create({
      data: {
        tenantId,
        caseId: caseRecord.id,
        caseRef: caseRecord.caseRef,
        objectKey,
        sha256: this.sha256(packageBuffer),
        source: 'case-package'
      }
    });

    const checklistStats = this.summarizeChecklist(checklist ?? undefined);

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      action: 'CASE_PACKAGE_EXPORTED',
      metadata: {
        artifactId: artifact.id,
        objectKey,
        documentCount: documents.length,
        checklistCompleted: checklistStats.completed,
        checklistTotal: checklistStats.total
      }
    });

    return {
      artifactId: artifact.id,
      objectKey,
      documentCount: documents.length,
      checklist: checklistStats
    };
  }

  async getLatestPackage(tenantId: string, actorId: string, caseRef: string) {
    const artifact = await prisma.artifact.findFirst({
      where: { tenantId, caseRef, source: 'case-package' },
      orderBy: { createdAt: 'desc' }
    });

    if (!artifact) {
      await this.auditService.logAction({
        tenantId,
        actorId,
        caseRef,
        action: 'CASE_PACKAGE_DOWNLOAD_DENIED',
        metadata: { reason: 'no_package_available' }
      });
      throw new NotFoundException('No package has been generated for this case');
    }

    const filename = path.basename(artifact.objectKey);
    const filePath = path.join(PACKAGE_DIR, filename);

    if (!fs.existsSync(filePath)) {
      await this.auditService.logAction({
        tenantId,
        actorId,
        caseRef,
        caseId: artifact.caseId,
        action: 'CASE_PACKAGE_DOWNLOAD_DENIED',
        metadata: { reason: 'file_missing', artifactId: artifact.id }
      });
      throw new NotFoundException('Generated package file is missing');
    }

    const buffer = await fs.promises.readFile(filePath);

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseRef,
      caseId: artifact.caseId,
      action: 'CASE_PACKAGE_DOWNLOADED',
      metadata: { artifactId: artifact.id, objectKey: artifact.objectKey }
    });

    return { buffer, filename };
  }
}
