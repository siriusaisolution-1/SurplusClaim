import assert from 'node:assert';
import crypto from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateCaseRef } from '@surplus/shared';
import { AppModule } from '../src/app.module';
import { hashPasswordForStorage } from '../src/auth/password.util';
import { prisma } from '../src/prisma/prisma.client';

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

function createPdfBuffer(label: string) {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Label (${label}) >>\nendobj\n%%EOF\n`,
    'utf8'
  );
}

async function main() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Happy Path Tenant' } });
  const admin = await prisma.user.create({
    data: { tenantId: tenant.id, email: 'admin@happy.test', fullName: 'Happy Admin', role: 'TENANT_ADMIN', passwordHash: hashPasswordForStorage('PasswordAdmin1!') }
  });
  const reviewer = await prisma.user.create({
    data: { tenantId: tenant.id, email: 'reviewer@happy.test', fullName: 'Happy Reviewer', role: 'REVIEWER', passwordHash: hashPasswordForStorage('PasswordReviewer1!') }
  });
  const attorney = await prisma.attorney.create({ data: { tenantId: tenant.id, fullName: 'Happy Counsel', email: 'attorney@happy.test' } });

  const app = await bootstrapApp();
  const server = app.getHttpServer();

  try {
    const loginResponse = await request(server)
      .post('/auth/login')
      .send({ tenantId: tenant.id, email: admin.email, password: 'PasswordAdmin1!' })
      .expect(201);

    const token = loginResponse.body.accessToken as string;
    assert.ok(token, 'Expected access token');
    const authHeader = { Authorization: `Bearer ${token}` };

    const originalRandomBytes = crypto.randomBytes;
    crypto.randomBytes = ((size: number) => Buffer.alloc(size, 0)) as typeof crypto.randomBytes;

    const caseCreate = await request(server)
      .post('/cases')
      .set(authHeader)
      .send({
        jurisdiction: { state: 'CA', countycode: 'ORANGE' },
        assignedReviewerId: reviewer.id,
        assignedAttorneyId: attorney.id,
        legalExecutionMode: 'ATTORNEY_REQUIRED',
        metadata: { jurisdiction: { state: 'CA', county_code: 'ORANGE', county_name: 'Orange County' } }
      })
      .expect(201);

    crypto.randomBytes = originalRandomBytes;

    const caseRef = caseCreate.body.case?.caseRef as string;
    assert.ok(caseRef, 'Expected caseRef');
    assert.ok(validateCaseRef(caseRef), 'Expected valid caseRef');

    const transition = (toState: string, payload: Record<string, unknown> = {}) =>
      request(server)
        .post(`/cases/${caseRef}/transition`)
        .set(authHeader)
        .send({ toState, ...payload })
        .expect(201);

    await transition('TRIAGED');
    await transition('CLIENT_CONTACTED');

    const consentPresented = await request(server)
      .post(`/consents/cases/${caseRef}/present`)
      .set(authHeader)
      .send({ version: 'v1' })
      .expect(201);

    const consentToken = consentPresented.body.token as string;
    assert.ok(consentToken, 'Expected consent token');

    await request(server)
      .post('/consents/sign')
      .send({ token: consentToken, signerName: 'Happy Signer', signerEmail: 'signer@happy.test' })
      .expect(201);

    const consentCase = await prisma.case.findFirst({ where: { tenantId: tenant.id, caseRef } });
    assert.strictEqual(consentCase?.status, 'CONSENT_SIGNED');

    await transition('DOCUMENT_COLLECTION');

    const uploadDocument = async (docType: string, filename: string, label: string) => {
      const fileBuffer = createPdfBuffer(label);
      return request(server)
        .post(`/cases/${caseRef}/documents/upload`)
        .set(authHeader)
        .field('docType', docType)
        .attach('file', fileBuffer, { filename, contentType: 'application/pdf' })
        .expect(201);
    };

    const claimantUpload = await uploadDocument('claimant_id', 'claimant-id.pdf', 'claimant id');
    assert.ok(claimantUpload.body.document?.sha256, 'Expected checksum');

    const checklistItems = claimantUpload.body.checklist?.items ?? [];
    const claimantItem = checklistItems.find((item: any) => item.id === 'claimant_id');
    const ownershipItem = checklistItems.find((item: any) => item.id === 'proof_of_ownership');
    const w9Item = checklistItems.find((item: any) => item.id === 'w9');
    assert.strictEqual(claimantItem?.completed, true);
    assert.strictEqual(ownershipItem?.completed, false);
    assert.strictEqual(w9Item?.completed, false);

    const incompletePackage = await request(server)
      .post(`/cases/${caseRef}/package/generate`)
      .set(authHeader)
      .expect(400);

    assert.strictEqual(incompletePackage.body.message, 'Checklist incomplete');
    assert.ok(incompletePackage.body.missing?.length > 0);

    await uploadDocument('proof_of_ownership', 'proof-of-ownership.pdf', 'proof');
    await uploadDocument('w9', 'w9.pdf', 'w9');

    const packageResponse = await request(server)
      .post(`/cases/${caseRef}/package/generate`)
      .set(authHeader)
      .expect(201);

    assert.ok(packageResponse.body.artifactId, 'Expected package artifact');
    assert.strictEqual(packageResponse.body.documentCount, 3);

    await transition('PACKAGE_READY');
    await transition('SUBMITTED_BY_PARTNER');

    const expectedPayoutWindow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await transition('AWAITING_RESPONSE', { expectedPayoutWindow, closureConfirmationRequired: true });

    const submissionEvents = await prisma.caseEvent.findMany({ where: { tenantId: tenant.id, caseRef, type: 'SUBMISSION_STATUS_ENTERED' } });
    const submissionStates = submissionEvents.map((event) => (event.payload as any)?.to);
    assert.ok(submissionStates.includes('SUBMITTED_BY_PARTNER'));
    assert.ok(submissionStates.includes('AWAITING_RESPONSE'));

    const payoutResponse = await request(server)
      .post(`/cases/${caseRef}/payouts/confirm`)
      .set(authHeader)
      .field('amountCents', '10000')
      .field('attorneyFeeCents', '2500')
      .field('currency', 'USD')
      .field('reference', 'happy-payout')
      .attach('evidence', await createPdfBuffer('payout evidence'), { filename: 'payout.pdf', contentType: 'application/pdf' })
      .expect(201);

    assert.strictEqual(payoutResponse.body.status, 'PAYOUT_CONFIRMED');
    assert.ok(payoutResponse.body.evidence?.sha256, 'Expected payout evidence hash');

    await request(server)
      .post(`/cases/${caseRef}/closure/confirm`)
      .set(authHeader)
      .send({ confirmed: true, note: 'closure confirmed' })
      .expect(201);

    const closeResponse = await transition('CLOSED');
    assert.strictEqual(closeResponse.body.status, 'CLOSED');

    const closedCase = await prisma.case.findFirst({ where: { tenantId: tenant.id, caseRef } });
    assert.strictEqual(closedCase?.status, 'CLOSED');

    const auditVerify = await request(server).get('/audit/verify').set(authHeader).expect(200);
    assert.strictEqual(auditVerify.body.isValid, true);
    console.log('Happy path e2e test completed successfully');
  } finally {
    await app.close();
  }
}

main()
  .catch((error) => {
    console.error('Happy path e2e test failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
