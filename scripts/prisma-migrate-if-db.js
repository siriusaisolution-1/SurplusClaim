#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log('Skipping prisma migrate deploy: DATABASE_URL is not set.');
  process.exit(0);
}

const schemaPath = path.resolve(__dirname, '..', 'apps', 'api', 'prisma', 'schema.prisma');

if (!fs.existsSync(schemaPath)) {
  console.error(`Schema file not found at ${schemaPath}`);
  process.exit(1);
}

console.log(`Running prisma migrate deploy with schema ${schemaPath}`);

const result = spawnSync(
  'pnpm',
  ['--filter', '@surplus/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schemaPath],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
