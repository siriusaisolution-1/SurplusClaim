const { execSync } = require('child_process');
const net = require('net');

const dbUrl = process.env.DATABASE_URL ?? 'postgresql://surplus:surplus@localhost:5432/surplus';
process.env.DATABASE_URL = dbUrl;
const skipPrismaSetup = process.env.SKIP_PRISMA_DB_SETUP === 'true';

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

    const url = new URL(dbUrl.replace(/^postgresql/, 'postgres'));
    const port = url.port ? Number(url.port) : 5432;
    const reachable = await canReach(url.hostname, port);
    const isCi = process.env.CI === 'true';

    if (!reachable) {
      if (isCi) {
        console.error(
          `CI=true and database is unreachable at ${url.hostname}:${port}; failing DB-dependent tests.`
        );
        process.exit(1);
      }
      console.warn(`Skipping DB-dependent tests (database unreachable at ${url.hostname}:${port})`);
      return;
    }

    if (!skipPrismaSetup) {
      run('pnpm exec prisma migrate deploy --schema ./prisma/schema.prisma');
    } else {
      console.log('Skipping Prisma migrate deploy (SKIP_PRISMA_DB_SETUP=true)');
    }

    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/fee-calculator.test.ts');
    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/case-transition-guard.test.ts');
    run('pnpm exec ts-node --project ./tsconfig.test.json ./test/integration.test.ts');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
