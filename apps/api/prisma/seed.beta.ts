import { prisma } from '../src/prisma/prisma.client';
import { hashPasswordForStorage } from '../src/auth/password.util';

const TENANT_NAME = 'Beta Tenant';
const JURISDICTION = {
  state: 'CA',
  county_code: 'LOS_ANGELES',
  county_name: 'Los Angeles County'
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const adminEmail = requireEnv('BETA_ADMIN_EMAIL');
  const adminPassword = requireEnv('BETA_ADMIN_PASSWORD');
  const reviewerEmail = requireEnv('BETA_REVIEWER_EMAIL');
  const reviewerPassword = requireEnv('BETA_REVIEWER_PASSWORD');

  const tenant = await prisma.tenant.upsert({
    where: { name: TENANT_NAME },
    update: { name: TENANT_NAME },
    create: { name: TENANT_NAME }
  });

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
    update: {
      fullName: 'Beta Admin',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage(adminPassword)
    },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      fullName: 'Beta Admin',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage(adminPassword)
    }
  });

  const reviewer = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: reviewerEmail } },
    update: {
      fullName: 'Beta Reviewer',
      role: 'REVIEWER',
      passwordHash: hashPasswordForStorage(reviewerPassword)
    },
    create: {
      tenantId: tenant.id,
      email: reviewerEmail,
      fullName: 'Beta Reviewer',
      role: 'REVIEWER',
      passwordHash: hashPasswordForStorage(reviewerPassword)
    }
  });

  const baseCase = {
    tenantId: tenant.id,
    legalExecutionMode: 'ATTORNEY_REQUIRED' as const,
    assignedReviewerId: reviewer.id,
    metadata: { jurisdiction: JURISDICTION }
  };

  await prisma.case.upsert({
    where: { tenantId_caseRef: { tenantId: tenant.id, caseRef: 'CASE-BETA-001' } },
    update: { ...baseCase, status: 'DISCOVERED', tierSuggested: 'MEDIUM' },
    create: {
      ...baseCase,
      caseRef: 'CASE-BETA-001',
      status: 'DISCOVERED',
      tierSuggested: 'MEDIUM'
    }
  });

  await prisma.case.upsert({
    where: { tenantId_caseRef: { tenantId: tenant.id, caseRef: 'CASE-BETA-002' } },
    update: { ...baseCase, status: 'PACKAGE_READY', tierSuggested: 'HIGH' },
    create: {
      ...baseCase,
      caseRef: 'CASE-BETA-002',
      status: 'PACKAGE_READY',
      tierSuggested: 'HIGH'
    }
  });

  console.log(`Seeded ${TENANT_NAME} with ${admin.email} and ${reviewer.email}.`);
}

main()
  .catch((error) => {
    console.error('Beta seed failed', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
