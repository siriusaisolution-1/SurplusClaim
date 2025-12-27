// apps/api/test/fee-calculator.test.ts

import assert from 'node:assert';

import { calculateFee } from '../src/fees/fee-calculator';

(function main() {
  // Case 1: Min fee kicks in (this is the 4500 vs 5000 situation)
  {
    const result = calculateFee({
      payoutAmountCents: 25_000, // $250.00
      policy: {
        feeRateBps: 1200, // 12% => raw = $30.00 => 3000 cents
        minFeeCents: 4500, // $45.00
        capAmountCents: null,
      },
    });

    assert.strictEqual(result.feeCents, 4500);
    assert.strictEqual(result.minFeeApplied, true);
    assert.strictEqual(result.capApplied, false);
  }

  // Case 2: Normal percentage (no min/cap effect)
  {
    const result = calculateFee({
      payoutAmountCents: 100_000, // $1000.00
      policy: {
        feeRateBps: 1200, // 12% => 12000 cents
        minFeeCents: 4500,
        capAmountCents: null,
      },
    });

    assert.strictEqual(result.feeCents, 12_000);
    assert.strictEqual(result.minFeeApplied, false);
    assert.strictEqual(result.capApplied, false);
  }

  // Case 3: Cap kicks in
  {
    const result = calculateFee({
      payoutAmountCents: 200_000, // $2000.00
      policy: {
        feeRateBps: 1200, // 12% => 24000 cents
        minFeeCents: 4500,
        capAmountCents: 15_000, // $150 cap
      },
    });

    assert.strictEqual(result.feeCents, 15_000);
    assert.strictEqual(result.minFeeApplied, false);
    assert.strictEqual(result.capApplied, true);
  }

  console.log('Fee calculator tests passed');
})();
