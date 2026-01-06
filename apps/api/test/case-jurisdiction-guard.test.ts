import assert from 'node:assert';

import { BadRequestException } from '@nestjs/common';
import { TierLevel } from '@prisma/client';
import { generateCaseRef } from '@surplus/shared';

import { hashPasswordForStorage } from '../src/auth/password.util';
import { CasesService } from '../src/cases/cases.service';
import { prisma } from '../src/prisma/prisma.client';

async function setup() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Jurisdiction Guard Tenant' } });
  const actor = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'ops@test.local',
      fullName: 'Ops User',
      role: 'OPS',
      passwordHash: hashPasswordForStorage('Password1!')
    }
  });

  const casesService = new CasesService(
    { logAction: async () => ({}) } as any,
    { validateStructuredSuggestion: () => ({}), disclaimer: 'n/a' } as any
  );

  return { tenant, actor, casesService };
}

async function main() {
  const { tenant, actor, casesService } = await setup();

  const disabledRef = generateCaseRef({ state: 'NY', countycode: 'KINGS', date: '2024-01-01' });

  await assert.rejects(
    () => casesService.createCase(tenant.id, actor.id, { caseRef: disabledRef }),
    (error) => error instanceof BadRequestException
  );

  const enabledRef = generateCaseRef({ state: 'GA', countycode: 'FULTON', date: '2024-01-01' });
  const created = await casesService.createCase(tenant.id, actor.id, {
    caseRef: enabledRef,
    tierSuggested: TierLevel.MEDIUM
  });

  assert.strictEqual(created.caseRef, enabledRef);

  console.log('Case jurisdiction guard tests passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
