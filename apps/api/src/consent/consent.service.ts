import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

import { AuditService } from '../audit/audit.service';
import { prisma } from '../prisma/prisma.client';

type PresentConsentInput = { version?: string };

type SignConsentInput = { token: string; signerName: string; signerEmail?: string };

type ConsentTokenPayload = { tenantId: string; caseRef: string; version: string };

const CONSENT_DIR = path.join(process.cwd(), 'apps', 'api', 'storage', 'consents');
const CONSENT_TOKEN_SECRET = process.env.CONSENT_TOKEN_SECRET ?? 'consent-token-dev-secret';
const CONSENT_PORTAL_BASE =
  process.env.CONSENT_PORTAL_BASE_URL ?? 'https://client.surplus.local/consent';

@Injectable()
export class ConsentService {
  constructor(private auditService: AuditService) {
    if (!fs.existsSync(CONSENT_DIR)) {
      fs.mkdirSync(CONSENT_DIR, { recursive: true });
    }
  }

  async presentConsent(tenantId: string, actorId: string, caseRef: string, input: PresentConsentInput) {
    const caseRecord = await prisma.case.findFirst({ where: { tenantId, caseRef } });
    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    const version = input.version ?? 'v1';
    const token = this.signToken({ tenantId, caseRef, version });
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);
    const consentLink = `${CONSENT_PORTAL_BASE}?token=${encodeURIComponent(token)}`;

    await prisma.caseEvent.create({
      data: {
        tenantId,
        caseId: caseRecord.id,
        caseRef,
        type: 'CONSENT_PRESENTED',
        payload: { version, expiresAt }
      }
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseId: caseRecord.id,
      caseRef,
      action: 'CONSENT_PRESENTED',
      metadata: { version, consentLink, expiresAt }
    });

    return { link: consentLink, version, expiresAt, token };
  }

  async signConsent(input: SignConsentInput) {
    const payload = this.verifyToken(input.token);
    const caseRecord = await prisma.case.findFirst({
      where: { tenantId: payload.tenantId, caseRef: payload.caseRef }
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    if (!input.signerName || input.signerName.trim().length < 2) {
      throw new BadRequestException('Signer name is required');
    }

    const signedAt = new Date();
    const pdfBuffer = await this.generateConsentPdf({
      caseRef: payload.caseRef,
      tenantId: payload.tenantId,
      version: payload.version,
      signerName: input.signerName.trim(),
      signerEmail: input.signerEmail,
      signedAt
    });

    const { artifact, consent, updatedCase } = await prisma.$transaction(async (tx) => {
      const objectKey = this.buildObjectKey(payload.caseRef, payload.version);
      const artifactRecord = await tx.artifact.create({
        data: {
          tenantId: payload.tenantId,
          caseId: caseRecord.id,
          caseRef: payload.caseRef,
          objectKey,
          sha256: this.sha256(pdfBuffer),
          source: 'consent-signature'
        }
      });

      const consentRecord = await tx.consent.create({
        data: {
          tenantId: payload.tenantId,
          caseId: caseRecord.id,
          caseRef: payload.caseRef,
          consentVersion: payload.version,
          consentArtifactId: artifactRecord.id,
          signedAt,
          revokedAt: null
        }
      });

      const consentEligibleStatuses: CaseStatus[] = [
        CaseStatus.DISCOVERED,
        CaseStatus.TRIAGED,
        CaseStatus.CLIENT_CONTACTED
      ];

      const shouldAdvanceToConsent = consentEligibleStatuses.includes(caseRecord.status);

      const updated = shouldAdvanceToConsent
        ? await tx.case.update({ where: { id: caseRecord.id }, data: { status: CaseStatus.CONSENT_SIGNED } })
        : caseRecord;

      await tx.caseEvent.create({
        data: {
          tenantId: payload.tenantId,
          caseId: caseRecord.id,
          caseRef: payload.caseRef,
          type: 'CONSENT_SIGNED',
          payload: {
            version: payload.version,
            signerName: input.signerName.trim(),
            signerEmail: input.signerEmail ?? null,
            signedAt
          }
        }
      });

      if (shouldAdvanceToConsent) {
        await tx.caseEvent.create({
          data: {
            tenantId: payload.tenantId,
            caseId: caseRecord.id,
            caseRef: payload.caseRef,
            type: 'CASE_STATUS_CHANGED',
            payload: {
              from: caseRecord.status,
              to: CaseStatus.CONSENT_SIGNED,
              reason: 'Consent signed via portal'
            }
          }
        });
      }

      return { artifact: artifactRecord, consent: consentRecord, updatedCase: updated };
    });

    await this.storeArtifactFile(payload.caseRef, payload.version, pdfBuffer);

    await this.auditService.logAction({
      tenantId: payload.tenantId,
      actorId: null,
      caseId: caseRecord.id,
      caseRef: payload.caseRef,
      action: 'CONSENT_SIGNED',
      metadata: {
        version: payload.version,
        signerName: input.signerName.trim(),
        signerEmail: input.signerEmail ?? null,
        consentArtifactId: artifact.id
      }
    });

    return { consent, artifact, caseStatus: updatedCase.status };
  }

  async hasActiveConsent(tenantId: string, caseRef: string) {
    const record = await prisma.consent.findFirst({
      where: { tenantId, caseRef, revokedAt: null },
      orderBy: { signedAt: 'desc' }
    });

    return Boolean(record);
  }

  private signToken(payload: ConsentTokenPayload) {
    return jwt.sign(payload, CONSENT_TOKEN_SECRET, { expiresIn: '3d' });
  }

  private verifyToken(token: string): ConsentTokenPayload {
    try {
      return jwt.verify(token, CONSENT_TOKEN_SECRET) as ConsentTokenPayload;
    } catch (error) {
      throw new BadRequestException('Invalid or expired consent token');
    }
  }

  private buildObjectKey(caseRef: string, version: string) {
    const safeRef = caseRef.replace(/[^a-zA-Z0-9_-]/g, '_');
    const unique = randomBytes(4).toString('hex');
    return `consents/${safeRef}-consent-${version}-${unique}.pdf`;
  }

  private async storeArtifactFile(caseRef: string, version: string, buffer: Buffer) {
    const safeRef = caseRef.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeRef}-consent-${version}.pdf`;
    const targetPath = path.join(CONSENT_DIR, filename);
    await fs.promises.writeFile(targetPath, buffer);
    return targetPath;
  }

  private sha256(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private generateConsentPdf(params: {
    caseRef: string;
    tenantId: string;
    version: string;
    signerName: string;
    signerEmail?: string;
    signedAt: Date;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      doc.fontSize(18).text('Client Consent & Engagement Summary', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Case reference: ${params.caseRef}`);
      doc.text(`Consent version: ${params.version}`);
      doc.text(`Tenant: ${params.tenantId}`);
      doc.moveDown();
      doc.text('By signing, you acknowledge and agree to the following:');
      doc.moveDown();
      doc.list(
        [
          'SurplusClaim is not a law firm and does not provide legal advice or legal representation.',
          'Services are delivered on a success fee basis. Fees are only due if recovery is obtained.',
          'You authorize SurplusClaim to collect, process, and store your data for the purpose of administering the claim.'
        ],
        { bulletRadius: 2 }
      );
      doc.moveDown();
      doc.text('Signature Details', { underline: true });
      doc.text(`Signer: ${params.signerName}`);
      if (params.signerEmail) {
        doc.text(`Email: ${params.signerEmail}`);
      }
      doc.text(`Signed at: ${params.signedAt.toISOString()}`);
      doc.moveDown();
      doc.text('By providing your electronic signature, you affirm your consent to the above.');

      const footer = `Case ${params.caseRef} • Consent ${params.version}`;
      doc.moveTo(doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 10);
      doc.fontSize(10).text(footer, doc.page.margins.left, doc.page.height - 40, {
        align: 'center',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right
      });

      doc.end();
    });
  }
}
