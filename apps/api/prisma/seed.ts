import { prisma } from '../src/prisma/prisma.client';

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
      fullName: 'Demo Admin'
    },
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.local',
      fullName: 'Demo Admin',
      role: 'TENANT_ADMIN'
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
