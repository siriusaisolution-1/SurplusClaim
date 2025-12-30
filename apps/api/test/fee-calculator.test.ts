import assert from 'node:assert';

import { FeeCalculatorService } from '../src/payouts/fee-calculator.service';

const calculator = new FeeCalculatorService();

(async () => {
  // 12% of realized attorney fee
  const baseline = calculator.calculate({ attorneyFeeCents: 100_000 });
  assert.strictEqual(baseline.appliedRateBps, 1200);
  assert.strictEqual(baseline.feeCents, 12_000);
  assert.deepStrictEqual(baseline.rationale, ['Phase 1 CA rule: 12% of realized attorney fee']);

  // Rounding remains consistent
  const rounded = calculator.calculate({ attorneyFeeCents: 33_333 });
  assert.strictEqual(rounded.feeCents, Math.round(33_333 * 0.12));

  // Input validation
  assert.throws(() => calculator.calculate({ attorneyFeeCents: 0 }), /Attorney fee must be positive/);
})();
