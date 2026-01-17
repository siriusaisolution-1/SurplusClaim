import assert from 'node:assert';
import crypto from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import AdmZip from 'adm-zip';
import PDFDocument from 'pdfkit';
import request from 'supertest';

import { validateCaseRef } from '@surplus/shared';
import { ReminderWorkerService } from '../../worker/src/reminders/reminder.worker';
import { prisma as workerPrisma } from '../../worker/src/prisma.client';
import { AppModule } from '../src/app.module';
import { hashPasswordForStorage } from '../src/auth/password.util';
import { prisma } from '../src/prisma/prisma.client';

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function createPdfBuffer(label: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: [200, 200] });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(12).text(label, 20, 80);
    doc.end();
  });
}

function assertRequestId(response: request.Response) {
  const requestId = response.headers['x-request-id'];
  assert.ok(requestId, 'Expected X-Request-Id header');
}

async function main() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Happy Path Tenant' } });
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@happy.test',
      fullName: 'Happy Admin',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage('PasswordAdmin1!')
    }
  });
  const reviewer = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'reviewer@happy.test',
      fullName: 'Happy Reviewer',
      role: 'REVIEWER',
      passwordHash: hashPasswordForStorage('PasswordReviewer1!')
    }
  });
  const attorney = await prisma.attorney.create({ data: { tenantId: tenant.id, fullName: 'Happy Counsel', email: 'attorney@happy.test' } });

  const app = await bootstrapApp();
  const server = app.getHttpServer();

  try {
    const loginResponse = await request(server)
      .post('/auth/login')
      .send({ tenantId: tenant.id, email: admin.email, password: 'PasswordAdmin1!' })
      .expect(201);
    assertRequestId(loginResponse);

    const token = loginResponse.body.accessToken as string;
    assert.ok(token, 'Expected access token');
    const authHeader = { Authorization: `Bearer ${token}` };

    const originalRandomBytes = crypto.randomBytes;
    crypto.randomBytes = ((size: number) => Buffer.alloc(size, 0)) as typeof crypto.randomBytes;

    const caseCreate = await request(server)
      .post('/cases')
      .set(authHeader)
      .send({
        jurisdiction: { state: 'CA', countycode: 'LOS_ANGELES' },
        assignedReviewerId: reviewer.id,
        assignedAttorneyId: attorney.id,
        legalExecutionMode: 'ATTORNEY_REQUIRED',
        metadata: { jurisdiction: { state: 'CA', county_code: 'LOS_ANGELES', county_name: 'Los Angeles County' } }
      })
      .expect(201);
    assertRequestId(caseCreate);

    crypto.randomBytes = originalRandomBytes;

    const caseRef = caseCreate.body.case?.caseRef as string;
    assert.ok(caseRef, 'Expected caseRef');
    assert.ok(validateCaseRef(caseRef), 'Expected valid caseRef');

    const transition = async (toState: string, payload: Record<string, unknown> = {}) => {
      const response = await request(server)
        .post(`/cases/${caseRef}/transition`)
        .set(authHeader)
        .send({ toState, ...payload })
        .expect(201);
      assertRequestId(response);
      return response;
    };

    await transition('TRIAGED');
    await transition('CLIENT_CONTACTED');

    const consentPresented = await request(server)
      .post(`/consents/cases/${caseRef}/present`)
      .set(authHeader)
      .send({ version: 'v1' })
      .expect(201);
    assertRequestId(consentPresented);

    const consentToken = consentPresented.body.token as string;
    assert.ok(consentToken, 'Expected consent token');

    const consentSigned = await request(server)
      .post('/consents/sign')
      .send({ token: consentToken, signerName: 'Happy Signer', signerEmail: 'signer@happy.test' })
      .expect(201);
    assertRequestId(consentSigned);

    const consentCase = await prisma.case.findFirst({ where: { tenantId: tenant.id, caseRef } });
    assert.strictEqual(consentCase?.status, 'CONSENT_SIGNED');

    await transition('DOCUMENT_COLLECTION');

    const uploadDocument = async (docType: string, filename: string, label: string) => {
      const response = await request(server)
        .post(`/cases/${caseRef}/documents/upload`)
        .set(authHeader)
        .field('docType', docType)
        .attach('file', await createPdfBuffer(label), { filename, contentType: 'application/pdf' })
        .expect(201);
      assertRequestId(response);
      return response;
    };

    await uploadDocument('claimant_id', 'claimant-id.pdf', 'claimant id');
    await uploadDocument('proof_of_ownership', 'proof-of-ownership.pdf', 'proof');
    await uploadDocument('w9', 'w9.pdf', 'w9');

    const packageResponse = await request(server)
      .post(`/cases/${caseRef}/package/generate`)
      .set(authHeader)
      .expect(201);
    assertRequestId(packageResponse);

    assert.ok(packageResponse.body.artifactId, 'Expected package artifact');
    assert.strictEqual(packageResponse.body.documentCount, 3);

    const packageArtifact = await prisma.artifact.findFirst({
      where: { tenantId: tenant.id, caseRef, source: 'case-package' }
    });
    assert.ok(packageArtifact, 'Expected package artifact record');

    const packageDownload = await request(server)
      .get(`/cases/${caseRef}/package/download`)
      .set(authHeader)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    assertRequestId(packageDownload);

    const zip = new AdmZip(packageDownload.body as Buffer);
    const metadata = JSON.parse(zip.readAsText('package-metadata.json')) as { case: { caseRef: string } };
    assert.strictEqual(metadata.case.caseRef, caseRef);

    await transition('PACKAGE_READY');
    await transition('SUBMITTED_BY_PARTNER');

    const expectedPayoutWindow = new Date('2099-01-01T00:00:00.000Z').toISOString();
    await transition('AWAITING_RESPONSE', { expectedPayoutWindow, closureConfirmationRequired: true });

    const reminderWorker = new ReminderWorkerService({ log: () => {}, warn: () => {}, error: () => {} } as any);
    await (reminderWorker as any).scanAndSchedule();

    const submissionReminder = await prisma.communication.findFirst({
      where: { tenantId: tenant.id, caseRef, templateId: 'submission_status_reminder' },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(submissionReminder, 'Expected submission reminder scheduled');
    assert.ok(submissionReminder?.subject.includes(caseRef));

    const payoutResponse = await request(server)
      .post(`/cases/${caseRef}/payouts/confirm`)
      .set(authHeader)
      .field('amountCents', '10000')
      .field('attorneyFeeCents', '2500')
      .field('currency', 'USD')
      .field('reference', 'happy-payout')
      .attach('evidence', await createPdfBuffer('trust evidence'), { filename: 'trust-evidence.pdf', contentType: 'application/pdf' })
      .expect(201);
    assertRequestId(payoutResponse);

    assert.strictEqual(payoutResponse.body.status, 'PAYOUT_CONFIRMED');
    assert.ok(payoutResponse.body.evidence?.sha256, 'Expected payout evidence hash');

    const closureResponse = await request(server)
      .post(`/cases/${caseRef}/closure/confirm`)
      .set(authHeader)
      .send({ confirmed: true, note: 'closure confirmed' })
      .expect(201);
    assertRequestId(closureResponse);

    const closeResponse = await transition('CLOSED');
    assert.strictEqual(closeResponse.body.status, 'CLOSED');

    const auditVerify = await request(server).get('/audit/verify').set(authHeader).expect(200);
    assertRequestId(auditVerify);
    assert.strictEqual(auditVerify.body.isValid, true);
    console.log('E2E happy path test completed successfully');
  } finally {
    await app.close();
  }
}

main()
  .catch((error) => {
    console.error('E2E happy path test failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await workerPrisma.$disconnect();
  });
