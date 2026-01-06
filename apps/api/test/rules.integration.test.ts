if (process.env.RUN_API_INTEGRATION !== 'true') {
  console.log('Skipping rules integration test (set RUN_API_INTEGRATION=true to enable)');
  process.exit(0);
}

import assert from 'node:assert';

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

async function seedTenant() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Rules Tenant' } });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'rules@test.dev',
      fullName: 'Rules Reviewer',
      role: 'REVIEWER',
      passwordHash: hashPasswordForStorage('Password1!')
    }
  });

  const caseRecord = await prisma.case.create({
    data: {
      tenantId: tenant.id,
      caseRef: 'CASE-RULES-001',
      status: 'DISCOVERED',
      tierSuggested: 'LOW',
      assignedReviewerId: user.id,
      metadata: { jurisdiction: { state: 'GA', county_code: 'FULTON', county_name: 'Fulton County' } }
    }
  });

  return { tenant, user, caseRecord };
}

async function main() {
  const app = await bootstrapApp();
  const server = app.getHttpServer();
  const seed = await seedTenant();

  const login = await request(server)
    .post('/auth/login')
    .send({ tenantId: seed.tenant.id, email: seed.user.email, password: 'Password1!' })
    .expect(201);

  const token = login.body.accessToken;

  const jurisdictions = await request(server)
    .get('/rules/jurisdictions')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.ok(jurisdictions.body.jurisdictions.length >= 1);
  const fulton = jurisdictions.body.jurisdictions.find(
    (entry: any) => entry.state === 'GA' && entry.county_code === 'FULTON'
  );
  assert.ok(fulton, 'Fulton County should be enabled for testing');

  const ruleResponse = await request(server)
    .get('/rules/GA/FULTON')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.strictEqual(ruleResponse.body.rule.state, 'GA');
  assert.strictEqual(ruleResponse.body.rule.county_code, 'FULTON');

  const checklistResponse = await request(server)
    .get('/rules/GA/FULTON/checklist')
    .query({ case_ref: seed.caseRecord.caseRef })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.ok(Array.isArray(checklistResponse.body.checklist.items));
  assert.ok(checklistResponse.body.checklist.items.length >= 2);
  assert.strictEqual(checklistResponse.body.checklist.jurisdiction.county_name, 'Fulton County');

  console.log('Rules integration test completed successfully');
  await app.close();
}

main()
  .catch((error) => {
    console.error('Rules integration test failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
