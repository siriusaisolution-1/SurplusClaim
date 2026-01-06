import assert from 'node:assert';

import { INestApplication } from '@nestjs/common';
import { CaseStatus, LegalExecutionMode, TierLevel } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { hashPasswordForStorage } from '../../src/auth/password.util';
import { prisma } from '../../src/prisma/prisma.client';

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');
}

async function seedTenant() {
  await resetDatabase();
  const tenant = await prisma.tenant.create({ data: { name: 'Happy Path Tenant' } });
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@happy.test',
      fullName: 'Happy Admin',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage('Password1!')
    }
  });
  const attorney = await prisma.attorney.create({
    data: { tenantId: tenant.id, fullName: 'Harper Counsel', email: 'counsel@happy.test' }
  });
  return { tenant, admin, attorney };
}

function authed(server: any, token: string) {
  const authHeader = { Authorization: `Bearer ${token}` };

  return {
    post: (path: string) => request(server).post(path).set(authHeader),
    get: (path: string) => request(server).get(path).set(authHeader)
  };
}

async function main() {
  const app = await bootstrapApp();
  const server = app.getHttpServer();
  const { tenant, admin, attorney } = await seedTenant();

  const login = await request(server)
    .post('/auth/login')
    .send({ tenantId: tenant.id, email: admin.email, password: 'Password1!' })
    .expect(201);
  const token = login.body.accessToken;
  assert.ok(token, 'login should return an access token');

  const created = await authed(server, token)
    .post('/cases')
    .send({
      jurisdiction: { state: 'GA', countycode: 'FULTON' },
      tierSuggested: TierLevel.MEDIUM,
      assignedAttorneyId: attorney.id,
      legalExecutionMode: LegalExecutionMode.ATTORNEY_REQUIRED
    })
    .expect(201);
  const caseRef: string = created.body.case.caseRef;
  assert.ok(caseRef, 'case reference should be generated');
  assert.strictEqual(created.body.case.status, CaseStatus.DISCOVERED);

  const transition = async (toState: CaseStatus) => {
    const res = await authed(server, token)
      .post(`/cases/${caseRef}/transition`)
      .send({ toState, reason: 'e2e-progress' })
      .expect(201);
    assert.strictEqual(res.body.status, toState);
  };

  await transition(CaseStatus.TRIAGED);
  await transition(CaseStatus.CLIENT_CONTACTED);

  const presented = await authed(server, token)
    .post(`/consents/cases/${caseRef}/present`)
    .send({ version: 'v1' })
    .expect(201);
  assert.ok(presented.body.token, 'consent token should be issued');

  const signed = await request(server)
    .post('/consents/sign')
    .send({ token: presented.body.token, signerName: 'Casey Client', signerEmail: 'client@test.dev' })
    .expect(201);
  assert.strictEqual(signed.body.consent.caseRef, caseRef);
  assert.strictEqual(signed.body.consent.consentVersion, 'v1');

  await transition(CaseStatus.DOCUMENT_COLLECTION);

  const documentUpload = await authed(server, token)
    .post(`/cases/${caseRef}/documents/upload`)
    .attach('file', Buffer.from('mock-document'), 'id-proof.pdf')
    .field('docType', 'id_proof')
    .expect(201);
  assert.ok(documentUpload.body.document.id, 'document should be stored');

  await transition(CaseStatus.PACKAGE_READY);

  const submission = await authed(server, token)
    .post(`/cases/${caseRef}/submission`)
    .attach('file', Buffer.from('submission-evidence'), 'evidence.pdf')
    .field('channel', 'portal')
    .expect(201);
  assert.strictEqual(submission.body.caseStatus, CaseStatus.SUBMITTED);

  const payoutAmount = 100_000;
  const attorneyFee = 20_000;
  const payout = await authed(server, token)
    .post(`/cases/${caseRef}/payouts/confirm`)
    .attach('evidence', Buffer.from('payout-proof'), 'payout.txt')
    .field('amountCents', payoutAmount)
    .field('attorneyFeeCents', attorneyFee)
    .field('reference', 'payout-ref-1')
    .expect(201);

  assert.strictEqual(payout.body.status, CaseStatus.PAYOUT_CONFIRMED);
  assert.strictEqual(payout.body.payout.amountCents, payoutAmount);
  assert.strictEqual(payout.body.fee.appliedRateBps, 1200);
  assert.strictEqual(payout.body.fee.feeCents, Math.round(attorneyFee * 0.12));
  assert.ok(payout.body.invoice.id, 'invoice should be created');
  assert.ok(payout.body.evidence.sha256, 'evidence hash recorded');

  const payoutsList = await authed(server, token).get(`/cases/${caseRef}/payouts`).expect(200);
  assert.strictEqual(payoutsList.body.latestInvoice.id, payout.body.invoice.id);
  assert.strictEqual(payoutsList.body.latestPayout.feeCents, payout.body.fee.feeCents);

  const auditStatus = await authed(server, token).get('/audit/verify').expect(200);
  assert.strictEqual(auditStatus.body.isValid, true, 'audit chain should be valid');

  console.log('Happy path E2E test completed successfully');
  await app.close();
}

main()
  .catch((error) => {
    console.error('Happy path E2E test failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
