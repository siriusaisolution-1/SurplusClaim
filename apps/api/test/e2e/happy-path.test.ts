import assert from 'node:assert';
import { createHash } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
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

async function ensureDatabaseReady() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.warn('Skipping E2E happy path test (database unreachable).');
    await prisma.$disconnect();
    process.exit(0);
  }
}

async function seedTenant() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Happy Path Tenant' } });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@tenant-a.test',
      fullName: 'Admin A',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage('PasswordAdmin1!')
    }
  });

  return { tenant, admin };
}

async function transitionCase(server: any, token: string, caseRef: string, toState: string) {
  await request(server)
    .post(`/cases/${caseRef}/transition`)
    .set('Authorization', `Bearer ${token}`)
    .send({ toState })
    .expect(201);
}

async function main() {
  await ensureDatabaseReady();
  const app = await bootstrapApp();
  const server = app.getHttpServer();

  const seed = await seedTenant();

  const loginResponse = await request(server)
    .post('/auth/login')
    .send({ tenantId: seed.tenant.id, email: seed.admin.email, password: 'PasswordAdmin1!' })
    .expect(201);

  const token = loginResponse.body.accessToken;
  assert.ok(token, 'Access token should be returned');

  const createResponse = await request(server)
    .post('/cases')
    .set('Authorization', `Bearer ${token}`)
    .send({
      jurisdiction: { state: 'GA', countycode: 'FULTON' },
      legalExecutionMode: 'OPS_DIRECT'
    })
    .expect(201);

  const caseRef = createResponse.body.case.caseRef;
  assert.ok(caseRef, 'Case reference should be returned');

  await transitionCase(server, token, caseRef, 'TRIAGED');
  await transitionCase(server, token, caseRef, 'CLIENT_CONTACTED');

  const presentResponse = await request(server)
    .post(`/consents/cases/${caseRef}/present`)
    .set('Authorization', `Bearer ${token}`)
    .send({ version: 'v1' })
    .expect(201);

  const consentToken = presentResponse.body.token;
  assert.ok(consentToken, 'Consent token should be returned');

  const signResponse = await request(server)
    .post('/consents/sign')
    .send({ token: consentToken, signerName: 'Test Signer', signerEmail: 'signer@example.com' })
    .expect(201);

  assert.ok(signResponse.body.consent?.id, 'Consent should be created');
  assert.ok(signResponse.body.artifact?.id, 'Consent artifact should be created');

  const consent = await prisma.consent.findFirst({ where: { tenantId: seed.tenant.id, caseRef } });
  assert.ok(consent, 'Consent should be persisted');

  const consentArtifact = await prisma.artifact.findFirst({
    where: { tenantId: seed.tenant.id, caseRef, source: 'consent-signature' }
  });
  assert.ok(consentArtifact, 'Consent artifact should be persisted');

  const caseRecord = await prisma.case.findFirst({ where: { tenantId: seed.tenant.id, caseRef } });
  assert.ok(caseRecord, 'Case record should exist');

  const documentBuffer = Buffer.from('happy-path-doc');
  const documentHash = createHash('sha256').update(documentBuffer).digest('hex');

  await prisma.document.create({
    data: {
      tenantId: seed.tenant.id,
      caseId: caseRecord!.id,
      caseRef,
      objectKey: `${caseRef}/manual-document.pdf`,
      originalFilename: 'manual-document.pdf',
      sha256: documentHash,
      status: 'PENDING'
    }
  });

  await transitionCase(server, token, caseRef, 'DOCUMENT_COLLECTION');
  await transitionCase(server, token, caseRef, 'PACKAGE_READY');
  await transitionCase(server, token, caseRef, 'SUBMITTED');

  const amountCents = 250000;
  const attorneyFeeCents = 50000;
  const expectedFeeCents = Math.round((attorneyFeeCents * 1200) / 10000);

  const payoutResponse = await request(server)
    .post(`/cases/${caseRef}/payouts/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .field('amountCents', amountCents.toString())
    .field('attorneyFeeCents', attorneyFeeCents.toString())
    .attach('evidence', Buffer.from('evidence'), 'evidence.txt')
    .expect(201);

  assert.strictEqual(payoutResponse.body.fee?.appliedRateBps, 1200);
  assert.strictEqual(payoutResponse.body.fee?.feeCents, expectedFeeCents);
  assert.ok(payoutResponse.body.invoice?.id, 'Invoice should be returned');

  const invoice = await prisma.invoice.findFirst({ where: { tenantId: seed.tenant.id, caseRef } });
  assert.ok(invoice, 'Invoice should be persisted');
  assert.strictEqual(invoice?.amountCents, expectedFeeCents);

  const verifyResponse = await request(server)
    .get('/audit/verify')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.strictEqual(verifyResponse.body.isValid, true);

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
