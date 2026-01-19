const { execSync } = require('child_process');
const net = require('net');

const dbUrl = process.env.DATABASE_URL ?? 'postgresql://surplus:surplus@localhost:5432/surplus';
process.env.DATABASE_URL = dbUrl;
const skipPrismaSetup = process.env.SKIP_PRISMA_DB_SETUP === 'true';

if (
  process.env.CI === 'true' &&
  process.env.RUN_DB_TESTS === 'true' &&
  process.env.SKIP_PRISMA_DB_SETUP === 'true'
) {
  console.error(
    'Invalid CI configuration: RUN_DB_TESTS=true requires SKIP_PRISMA_DB_SETUP=false to run Prisma setup.'
  );
  process.exit(1);
}

const baseEnv = {
  ...process.env,
  TS_NODE_PROJECT: './tsconfig.test.json'
};

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', env: baseEnv });
}

function canReach(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1000 }, () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

(async () => {
  try {
    if (!skipPrismaSetup) {
      run('pnpm exec prisma generate --schema ./prisma/schema.prisma');
    } else {
      console.log('Skipping Prisma client generation (SKIP_PRISMA_DB_SETUP=true)');
    }

    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/legal-safety.test.ts');

    if (process.env.RUN_DB_TESTS !== 'true') {
      console.log('Skipping DB-dependent tests (RUN_DB_TESTS!=true)');
      return;
    }

    const normalizedDbUrl = dbUrl.replace(/^postgres(ql)?:\/\//, 'postgres://');
    const url = new URL(normalizedDbUrl);
    const port = url.port ? Number(url.port) : 5432;
    const reachable = await canReach(url.hostname, port);

    if (!reachable) {
      console.error(`Database is unreachable at ${url.hostname}:${port}; failing DB-dependent tests.`);
      process.exit(1);
    }

    if (!skipPrismaSetup) {
      run('pnpm exec prisma migrate deploy --schema ./prisma/schema.prisma');
    } else {
      console.log('Skipping Prisma migrate deploy (SKIP_PRISMA_DB_SETUP=true)');
    }

    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/fee-calculator.test.ts');
    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/case-transition-guard.test.ts');
    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/connector-runs.test.ts');
    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/happy-path.e2e.test.ts');
    if (process.env.RUN_API_INTEGRATION === 'true') {
      run('pnpm exec ts-node --project ./tsconfig.test.json ./test/integration.test.ts');
    } else {
      console.log('Skipping integration tests (RUN_API_INTEGRATION!=true)');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
