import assert from 'node:assert';
import crypto from 'node:crypto';

import { TierLevel } from '@prisma/client';
import { validateCaseRef } from '@surplus/shared';

import { hashPasswordForStorage } from '../src/auth/password.util';
import { CasesService } from '../src/cases/cases.service';
import { prisma } from '../src/prisma/prisma.client';

async function setup() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE;');

  const tenant = await prisma.tenant.create({ data: { name: 'Auto ref tenant' } });
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

  const fills = [0, 0, 1];
  const originalRandomBytes = crypto.randomBytes;
  let call = 0;
  crypto.randomBytes = ((size: number) => {
    const fill = fills[Math.min(call, fills.length - 1)];
    call += 1;
    return Buffer.alloc(size, fill);
  }) as any;

  try {
    const first = await casesService.createCase(tenant.id, actor.id, {
      jurisdiction: { state: 'GA', countycode: 'FULTON' },
      tierSuggested: TierLevel.MEDIUM
    });

    assert.ok(validateCaseRef(first.caseRef));

    const second = await casesService.createCase(tenant.id, actor.id, {
      jurisdiction: { state: 'GA', countycode: 'FULTON' }
    });

    assert.ok(validateCaseRef(second.caseRef));
    assert.notStrictEqual(first.caseRef, second.caseRef);

    console.log('Case auto-generation tests passed');
  } finally {
    crypto.randomBytes = originalRandomBytes;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
