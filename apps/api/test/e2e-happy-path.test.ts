if (process.env.RUN_API_INTEGRATION !== 'true') {
  console.log('Skipping E2E happy path test (set RUN_API_INTEGRATION=true to enable)');
  process.exit(0);
}

import assert from 'node:assert';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateCaseRef } from '@surplus/shared';
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

async function main() {
  let app: INestApplication | null = null;
  let tenantId: string | null = null;

  try {
    app = await bootstrapApp();
    const server = app.getHttpServer();

    const tenant = await prisma.tenant.create({
      data: { name: `E2E Happy Path ${Date.now()}` }
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'happy-path@test.local',
        fullName: 'Happy Path User',
        role: 'TENANT_ADMIN',
        passwordHash: hashPasswordForStorage('Password1!')
      }
    });

    const caseRef = generateCaseRef({
      state: 'GA',
      countycode: 'FULTON',
      date: new Date('2024-01-01T00:00:00.000Z')
    });

    const login = await request(server)
      .post('/auth/login')
      .send({ tenantId: tenant.id, email: user.email, password: 'Password1!' })
      .expect(201);

    const token = login.body.accessToken;
    assert.ok(token, 'Expected an access token');

    const createResponse = await request(server)
      .post('/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        caseRef,
        tierSuggested: 'LOW',
        metadata: {
          jurisdiction: {
            state: 'GA',
            county_code: 'FULTON',
            county_name: 'Fulton County'
          }
        }
      })
      .expect(201);

    const createdCase = createResponse.body.case;
    assert.strictEqual(createdCase.caseRef, caseRef);

    const document = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        caseId: createdCase.id,
        caseRef,
        objectKey: `${caseRef}/welcome-document.pdf`,
        originalFilename: 'welcome-document.pdf',
        sha256: 'hash-happy-path',
        docType: 'death_certificate',
        status: 'PENDING'
      }
    });

    const documentsResponse = await request(server)
      .get(`/cases/${caseRef}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const documentIds = documentsResponse.body.documents.map((doc: any) => doc.id);
    assert.ok(documentIds.includes(document.id));

    console.log('E2E happy path test completed successfully');
  } finally {
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    if (app) {
      await app.close();
    }
  }
}

main()
  .catch((error) => {
    console.error('E2E happy path test failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
