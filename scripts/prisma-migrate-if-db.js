#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const schemaPath = 'apps/api/prisma/schema.prisma';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log('Skipping prisma migrate deploy: DATABASE_URL is not set.');
  process.exit(0);
}

console.log(`Running prisma migrate deploy with schema ${schemaPath}`);

const result = spawnSync(
  'pnpm',
  ['--filter', '@surplus/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schemaPath],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
