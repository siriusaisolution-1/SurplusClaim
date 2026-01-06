import { Case, Prisma } from '@prisma/client';

import { prisma } from './prisma.client';

export async function findCaseByRefRaw(tenantId: string, caseRef: string): Promise<Case | null> {
  const rows = await prisma.$queryRaw<Case[]>(
    Prisma.sql`SELECT * FROM "Case" WHERE "tenantId" = ${tenantId}::uuid AND "caseRef" = ${caseRef} LIMIT 1`
  );

  return rows[0] ?? null;
}
