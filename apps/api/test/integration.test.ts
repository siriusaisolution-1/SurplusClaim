import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';

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

async function main() {
  runMigrations();

  // Basic CRUD against isolated tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'Test Tenant' }
  });

  const reviewer = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'reviewer@test.local',
      fullName: 'Integration Reviewer',
      role: 'REVIEWER'
    }
  });

  const caseRecord = await prisma.case.create({
    data: {
      tenantId: tenant.id,
      caseRef: 'CASE-001',
      status: 'NEW',
      tierSuggested: 'MEDIUM',
      assignedReviewerId: reviewer.id
    }
  });

  await prisma.caseEvent.create({
    data: {
      tenantId: tenant.id,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      type: 'CREATED',
      payload: { createdBy: reviewer.email }
    }
  });

  const auditEntry = await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      actorId: reviewer.id,
      action: 'CASE_CREATED',
      metadata: { reviewer: reviewer.email },
      hash: 'hash-1',
      prevHash: null
    }
  });

  const consentArtifact = await prisma.artifact.create({
    data: {
      tenantId: tenant.id,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      objectKey: 'artifacts/case-001/raw.json',
      sha256: 'deadbeef',
      source: 'ingest'
    }
  });

  const document = await prisma.document.create({
    data: {
      tenantId: tenant.id,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      objectKey: 'docs/case-001/id.pdf',
      sha256: 'cafebabe',
      docType: 'ID'
    }
  });

  await prisma.consent.create({
    data: {
      tenantId: tenant.id,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      consentVersion: 'v1',
      consentArtifactId: consentArtifact.id,
      signedAt: new Date()
    }
  });

  await prisma.communication.create({
    data: {
      tenantId: tenant.id,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      subject: 'CASE-001 Subject',
      body: 'Integration test body',
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      status: 'QUEUED'
    }
  });

  await prisma.payout.create({
    data: {
      tenantId: tenant.id,
      caseId: caseRecord.id,
      caseRef: caseRecord.caseRef,
      amountCents: 10000,
      currency: 'USD',
      status: 'PENDING'
    }
  });

  await prisma.feeAgreement.create({
    data: {
      tenantId: tenant.id,
      tierMin: 'LOW',
      tierMax: 'MEDIUM',
      capAmountCents: 500000,
      minFeeCents: 5000,
      b2bOverride: 3000
    }
  });

  const fetchedCase = await prisma.case.findFirstOrThrow({
    where: { tenantId: tenant.id, caseRef: 'CASE-001' },
    include: { assignedReviewer: true }
  });

  assert.strictEqual(fetchedCase.assignedReviewer?.id, reviewer.id);
  assert.strictEqual(auditEntry.action, 'CASE_CREATED');
  assert.ok(fetchedCase.caseRef.startsWith('CASE-'));

  console.log('Integration test completed successfully');
}

main()
  .catch((error) => {
    console.error('Integration test failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
