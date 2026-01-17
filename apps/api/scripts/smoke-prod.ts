import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TENANT_NAME = 'Beta Tenant';
const CASE_ONE = 'CASE-BETA-001';
const CASE_TWO = 'CASE-BETA-002';

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const buildUrl = (base: string, path: string) =>
  new URL(path, base.endsWith('/') ? base : `${base}/`).toString();

const requestJson = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}: ${JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
};

const waitForCommunication = async (tenantId: string, timeoutMs = 30_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const communication = await prisma.communication.findFirst({
      where: { tenantId, caseRef: CASE_TWO, templateId: 'submission_status_reminder' },
      orderBy: { createdAt: 'desc' }
    });
    if (communication) return communication;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return null;
};

async function main() {
  const apiBaseUrl = requireEnv('API_BASE_URL');
  const adminEmail = requireEnv('BETA_ADMIN_EMAIL');
  const adminPassword = requireEnv('BETA_ADMIN_PASSWORD');

  const tenant = await prisma.tenant.findUnique({ where: { name: TENANT_NAME } });
  if (!tenant) throw new Error(`Tenant not found: ${TENANT_NAME}. Run pnpm seed:beta first.`);

  await requestJson(buildUrl(apiBaseUrl, 'health'));
  await requestJson(buildUrl(apiBaseUrl, 'ready'));

  const login = await requestJson(buildUrl(apiBaseUrl, 'auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenant.id, email: adminEmail, password: adminPassword })
  });
  const accessToken = login.accessToken as string | undefined;
  if (!accessToken) throw new Error('Login did not return an access token.');

  const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const me = await requestJson(buildUrl(apiBaseUrl, 'me'), { headers: authHeaders });
  if (me.email !== adminEmail) throw new Error(`Logged in user mismatch: expected ${adminEmail}.`);

  const caseOne = await requestJson(buildUrl(apiBaseUrl, `cases/${CASE_ONE}`), { headers: authHeaders });
  if ((caseOne.case as Record<string, unknown> | undefined)?.caseRef !== CASE_ONE) {
    throw new Error(`Unexpected case data for ${CASE_ONE}.`);
  }

  const caseTwo = await requestJson(buildUrl(apiBaseUrl, `cases/${CASE_TWO}`), { headers: authHeaders });
  const caseTwoStatus = (caseTwo.case as Record<string, unknown> | undefined)?.status as string | undefined;
  if (!caseTwoStatus) throw new Error(`Missing case status for ${CASE_TWO}.`);

  if (!['SUBMITTED_BY_CLIENT', 'SUBMITTED_BY_PARTNER'].includes(caseTwoStatus)) {
    await requestJson(buildUrl(apiBaseUrl, `cases/${CASE_TWO}/transition`), {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ toState: 'SUBMITTED_BY_CLIENT', reason: 'smoke test' })
    });
  }

  const submissionEvent = await prisma.caseEvent.findFirst({
    where: { tenantId: tenant.id, caseRef: CASE_TWO, type: 'SUBMISSION_STATUS_ENTERED' },
    orderBy: { createdAt: 'desc' }
  });
  if (!submissionEvent) throw new Error('Expected SUBMISSION_STATUS_ENTERED case event was not found.');

  const communication = await waitForCommunication(tenant.id);
  if (!communication) {
    throw new Error(
      'submission_status_reminder communication not found. Ensure the worker is running and scan intervals are configured.'
    );
  }

  const audit = await requestJson(buildUrl(apiBaseUrl, 'audit/verify'), { headers: authHeaders });
  if (!audit.isValid) {
    console.error('Audit chain invalid:', JSON.stringify(audit.brokenRecord ?? audit, null, 2));
    throw new Error('Audit verification failed.');
  }

  console.log(`Smoke test passed for ${TENANT_NAME}.`);
}

main()
  .catch((error) => {
    console.error(`Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
