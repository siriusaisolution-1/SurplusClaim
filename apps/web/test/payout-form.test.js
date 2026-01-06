const assert = require('node:assert');
const { Blob } = require('node:buffer');

const { submitPayoutConfirmation } = require('../src/lib/payout-submit');

async function main() {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ invoice: { id: 'inv-1' }, payout: { id: 'pay-1' } })
    };
  };

  const payload = await submitPayoutConfirmation({
    apiBaseUrl: 'https://api.test',
    token: 'token',
    caseRef: 'CASE-123',
    payoutAmountCents: 10000,
    attorneyFeeCents: 2500,
    reference: 'ref-1',
    note: 'note',
    evidence: new Blob(['proof'], { type: 'text/plain' }),
    closeCase: true,
    fetchImpl: mockFetch
  });

  assert.strictEqual(calls.length, 1);
  const call = calls[0];
  assert.strictEqual(call.url, 'https://api.test/cases/CASE-123/payouts/confirm');
  assert.strictEqual(call.options.method, 'POST');
  assert.strictEqual(call.options.headers.Authorization, 'Bearer token');

  const body = call.options.body;
  assert.strictEqual(body.get('amountCents'), '10000');
  assert.strictEqual(body.get('attorneyFeeCents'), '2500');
  assert.strictEqual(body.get('reference'), 'ref-1');
  assert.strictEqual(body.get('note'), 'note');
  assert.ok(body.get('evidence'));
  assert.strictEqual(body.get('closeCase'), 'true');
  assert.strictEqual(payload.payout.id, 'pay-1');

  console.log('Payout confirmation form test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
