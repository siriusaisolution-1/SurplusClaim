import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['warn', 'error']
});

prisma.$use(async (params: any, next: (params: any) => Promise<any>) => {
  if (
    params.model === 'AuditLog' &&
    ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(params.action)
  ) {
    throw new Error('AuditLog is append-only and cannot be updated or deleted.');
  }
  return next(params);
});

export { prisma };
