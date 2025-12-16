import { prisma } from '../src/prisma/prisma.client';
import { hashPasswordForStorage } from '../src/auth/password.util';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { name: 'Demo Tenant' },
    update: {},
    create: {
      name: 'Demo Tenant'
    }
  });

  await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: 'admin@demo.local'
      }
    },
    update: {
      fullName: 'Demo Admin',
      passwordHash: hashPasswordForStorage('ChangeMe123!')
    },
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.local',
      fullName: 'Demo Admin',
      role: 'TENANT_ADMIN',
      passwordHash: hashPasswordForStorage('ChangeMe123!')
    }
  });
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
