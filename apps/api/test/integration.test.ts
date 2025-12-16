import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { hashPasswordForStorage } from '../src/auth/password.util';
import { prisma } from '../src/prisma/prisma.client';

const projectRoot = path.resolve(__dirname, '..');

function runMigrations() {
  execSync('pnpm exec prisma migrate deploy --schema ./prisma/schema.prisma', {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://surplus:surplus@localhost:5432/surplus'
    }
  });
}

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function seedTenants() {
  await prisma.auditLog.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.case.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A' } });
  const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B' } });

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
      status: 'NEW',
      tierSuggested: 'MEDIUM',
      assignedReviewerId: reviewerA.id
    }
  });

  await prisma.case.create({
    data: {
      tenantId: tenantB.id,
      caseRef: 'CASE-B-001',
      status: 'IN_REVIEW',
      tierSuggested: 'HIGH',
      assignedReviewerId: adminB.id
    }
  });

  return { tenantA, tenantB, reviewerA, adminB, caseA };
}

async function main() {
  runMigrations();
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

  assert.strictEqual(caseResponse.body.caseRef, seed.caseA.caseRef);

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
