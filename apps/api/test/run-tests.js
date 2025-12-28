const { execSync } = require('child_process');
const net = require('net');

const dbUrl = process.env.DATABASE_URL ?? 'postgresql://surplus:surplus@localhost:5432/surplus';
process.env.DATABASE_URL = dbUrl;

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
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
    run('pnpm exec prisma generate --schema ./prisma/schema.prisma');
    run('pnpm exec ts-node ./test/legal-safety.test.ts');

    const url = new URL(dbUrl.replace(/^postgresql/, 'postgres'));
    const port = url.port ? Number(url.port) : 5432;
    const reachable = await canReach(url.hostname, port);

    if (!reachable) {
      console.warn(`Skipping DB-dependent tests (database unreachable at ${url.hostname}:${port})`);
      return;
    }

    run('pnpm exec prisma migrate deploy --schema ./prisma/schema.prisma');
    run('pnpm exec ts-node ./test/fee-calculator.test.ts');
    run('pnpm exec ts-node ./test/integration.test.ts');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
