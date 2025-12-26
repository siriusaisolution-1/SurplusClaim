#!/usr/bin/env node
const { execSync } = require('node:child_process');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL not set; skipping API integration tests.');
  process.exit(0);
}

const apiRoot = path.join(__dirname, '..', 'apps', 'api');
execSync('pnpm exec ts-node ./test/integration.test.ts', {
  cwd: apiRoot,
  stdio: 'inherit',
  env: process.env
});
