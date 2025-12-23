#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log('Skipping integration tests: DATABASE_URL is not set.');
  process.exit(0);
}

const cwd = path.resolve(__dirname, '../apps/api');

const result = spawnSync('pnpm', ['exec', 'ts-node', './test/integration.test.ts'], {
  cwd,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
