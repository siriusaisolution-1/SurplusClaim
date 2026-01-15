if (process.env.RUN_API_INTEGRATION !== 'true') {
  console.log('Skipping API integration test (set RUN_API_INTEGRATION=true to enable)');
  process.exit(0);
}

import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { hashPasswordForStorage } from '../src/auth/password.util';
import { prisma } from '../src/prisma/prisma.client';

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function seedTenants() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A' } });
  const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B' } });

  const adminA = await prisma.user.create({
    data: {
      tenantId: tenantA.id,
      email: 'admin@tenant-a.test',
      fullName: 'Admin A',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage('PasswordAdmin1!')
    }
  });

  const reviewerA = await prisma.user.create({
    data: {
      tenantId: tenantA.id,
      email: 'reviewer@tenant-a.test',
      fullName: 'Reviewer A',
      role: 'REVIEWER',
      passwordHash: hashPasswordForStorage('Password1!')
    }
  });

  const adminB = await prisma.user.create({
    data: {
      tenantId: tenantB.id,
      email: 'admin@tenant-b.test',
      fullName: 'Admin B',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage('Password2!')
    }
  });

  const caseA = await prisma.case.create({
    data: {
      tenantId: tenantA.id,
      caseRef: 'CASE-A-001',
      status: 'DISCOVERED',
      tierSuggested: 'MEDIUM',
      legalExecutionMode: 'ATTORNEY_REQUIRED',
      assignedReviewerId: reviewerA.id,
      metadata: { jurisdiction: { state: 'CA', county_code: 'LOS_ANGELES', county_name: 'Los Angeles County' } }
    }
  });

  await prisma.case.create({
    data: {
      tenantId: tenantB.id,
      caseRef: 'CASE-B-001',
      status: 'TRIAGED',
      tierSuggested: 'HIGH',
      legalExecutionMode: 'ATTORNEY_REQUIRED',
      assignedReviewerId: adminB.id
    }
  });

  return { tenantA, tenantB, reviewerA, adminA, adminB, caseA };
}

async function main() {
  const app = await bootstrapApp();
  const server = app.getHttpServer();
  const seed = await seedTenants();

  const failedLogin = await request(server)
    .post('/auth/login')
    .send({ tenantId: seed.tenantA.id, email: seed.reviewerA.email, password: 'wrong' })
    .expect(401);
  assert.ok(failedLogin.body.message.includes('Invalid'));

  const loginResponse = await request(server)
    .post('/auth/login')
    .send({ tenantId: seed.tenantA.id, email: seed.reviewerA.email, password: 'Password1!' })
    .expect(201);

  const { accessToken, refreshToken } = loginResponse.body;
  assert.ok(accessToken && refreshToken, 'Tokens should be returned');

  const meResponse = await request(server)
    .get('/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  assert.strictEqual(meResponse.body.email, seed.reviewerA.email);

  const caseResponse = await request(server)
    .get('/cases/CASE-A-001')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  assert.ok(caseResponse.body?.case);
  assert.strictEqual(caseResponse.body.case?.caseRef, seed.caseA.caseRef);

  await request(server)
    .get('/cases/CASE-B-001')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(404);

  const deniedAudit = await prisma.auditLog.findFirst({
    where: { action: 'PERMISSION_DENIED', tenantId: seed.tenantA.id, caseRef: 'CASE-B-001' }
  });
  assert.ok(deniedAudit, 'Permission denial should be logged');

  const refreshResponse = await request(server).post('/auth/refresh').send({ refreshToken }).expect(201);
  assert.ok(refreshResponse.body.accessToken, 'Refresh should provide a new access token');

  await request(server)
    .post('/auth/logout')
    .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
    .send({ refreshToken })
    .expect(201);

  const loginAuditEntries = await prisma.auditLog.findMany({ where: { action: 'LOGIN_SUCCESS' } });
  assert.ok(loginAuditEntries.length >= 1);

  const adminLogin = await request(server)
    .post('/auth/login')
    .send({ tenantId: seed.tenantA.id, email: seed.adminA.email, password: 'PasswordAdmin1!' })
    .expect(201);

  const adminToken = adminLogin.body.accessToken;

  const verifyResponse = await request(server)
    .get('/audit/verify')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  assert.strictEqual(verifyResponse.body.isValid, true);

  const exportResponse = await request(server)
    .get('/audit/export')
    .query({ case_ref: 'CASE-A-001' })
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  assert.ok(exportResponse.text.includes('CASE_VIEWED'));

  const packageDenied = await request(server)
    .post('/cases/CASE-A-001/package/generate')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(400);

  assert.strictEqual(packageDenied.body.message, 'Checklist incomplete');
  assert.ok(Array.isArray(packageDenied.body.missing));

  const uploadsRoot = path.join(process.cwd(), 'services', 'uploads', 'tests');
  await fs.mkdir(uploadsRoot, { recursive: true });
  const minimalPdf = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n';
  await Promise.all([
    fs.writeFile(path.join(uploadsRoot, 'claimant-id.pdf'), minimalPdf),
    fs.writeFile(path.join(uploadsRoot, 'proof-of-ownership.pdf'), minimalPdf),
    fs.writeFile(path.join(uploadsRoot, 'w9.pdf'), minimalPdf)
  ]);

  await prisma.document.createMany({
    data: [
      {
        tenantId: seed.tenantA.id,
        caseId: seed.caseA.id,
        caseRef: seed.caseA.caseRef,
        objectKey: 'tests/claimant-id.pdf',
        originalFilename: 'claimant-id.pdf',
        sha256: 'hash-claimant',
        docType: 'claimant_id',
        status: 'PENDING'
      },
      {
        tenantId: seed.tenantA.id,
        caseId: seed.caseA.id,
        caseRef: seed.caseA.caseRef,
        objectKey: 'tests/proof-of-ownership.pdf',
        originalFilename: 'proof-of-ownership.pdf',
        sha256: 'hash-proof',
        docType: 'proof_of_ownership',
        status: 'PENDING'
      },
      {
        tenantId: seed.tenantA.id,
        caseId: seed.caseA.id,
        caseRef: seed.caseA.caseRef,
        objectKey: 'tests/w9.pdf',
        originalFilename: 'w9.pdf',
        sha256: 'hash-w9',
        docType: 'w9',
        status: 'PENDING'
      }
    ]
  });

  const packageOk = await request(server)
    .post('/cases/CASE-A-001/package/generate')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(201);

  assert.ok(packageOk.body.artifactId);

  const earliestAudit = await prisma.auditLog.findFirst({
    where: { tenantId: seed.tenantA.id },
    orderBy: { createdAt: 'asc' }
  });

  assert.ok(earliestAudit, 'Expected at least one audit entry to tamper with');

  if (earliestAudit) {
    await prisma.$executeRawUnsafe(
      `UPDATE "AuditLog" SET metadata = '{"tampered":true}' WHERE "id" = '${earliestAudit.id}'`
    );
  }

  const tamperedVerifyResponse = await request(server)
    .get('/audit/verify')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  assert.strictEqual(tamperedVerifyResponse.body.isValid, false);
  assert.ok(tamperedVerifyResponse.body.brokenRecord);

  console.log('Integration test completed successfully');
  await app.close();
}

main()
  .catch((error) => {
    console.error('Integration test failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
