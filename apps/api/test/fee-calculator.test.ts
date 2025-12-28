import assert from 'node:assert';

import { FeeCalculatorService } from '../src/payouts/fee-calculator.service';

const TierLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  ENTERPRISE: 'ENTERPRISE'
} as const;

const calculator = new FeeCalculatorService();

const baseAgreement = {
  id: 'agreement-1',
  tenantId: 'tenant-1',
  tierMin: TierLevel.LOW,
  tierMax: TierLevel.HIGH,
  capAmountCents: 32000,
  minFeeCents: 5000,
  b2bOverride: null,
  stateCode: 'CA',
  contractRef: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

(async () => {
  // Midpoint calculation
  const baseline = calculator.calculate({ amountCents: 100_000, tierBand: 'TIER_A' });
  assert.strictEqual(baseline.appliedRateBps, 1250);
  assert.strictEqual(baseline.feeCents, 12_500);

  // Cap enforcement via state
  const capped = calculator.calculate({
    amountCents: 200_000,
    tierBand: 'TIER_B',
    stateCode: 'CA',
    stateCaps: { CA: 30_000 }
  });
  assert.strictEqual(capped.feeCents, 30_000);
  assert.ok(capped.appliedCapCents === 30_000);

  // Minimum from agreement
  const minimumApplied = calculator.calculate({
    amountCents: 10_000,
    tierBand: 'TIER_C',
    agreement: baseAgreement
  });
  assert.strictEqual(minimumApplied.feeCents, 5_000);
  assert.strictEqual(minimumApplied.appliedMinCents, 5_000);

  // B2B override beats midpoint
  const b2bOverride = calculator.calculate({
    amountCents: 50_000,
    tierBand: 'TIER_B',
    agreement: { ...baseAgreement, b2bOverride: 900 }
  });
  assert.strictEqual(b2bOverride.appliedRateBps, 900);
  assert.strictEqual(b2bOverride.feeCents, 5_000);
  assert.strictEqual(b2bOverride.appliedMinCents, 5_000);

  // Contract override wins and ignores cap by rate while still respecting cap amount
  const contractOverride = calculator.calculate({
    amountCents: 500_000,
    tierBand: 'TIER_C',
    agreement: { ...baseAgreement, capAmountCents: 120_000 },
    contractRateBps: 700,
    stateCode: 'NY',
    stateCaps: { NY: 130_000 }
  });
  assert.strictEqual(contractOverride.appliedRateBps, 700);
  assert.strictEqual(contractOverride.feeCents, 35_000);
  assert.strictEqual(contractOverride.appliedCapCents, 120_000);

  // Referral override for tier C
  const referralOverride = calculator.calculate({
    amountCents: 80_000,
    tierBand: 'TIER_C',
    referralFeeBps: 1800
  });
  assert.strictEqual(referralOverride.appliedRateBps, 1800);
  assert.strictEqual(referralOverride.feeCents, 14_400);

  // Tier mapping helper
  assert.strictEqual(calculator.mapTierLevelToBand(TierLevel.LOW), 'TIER_A');
  assert.strictEqual(calculator.mapTierLevelToBand(TierLevel.MEDIUM), 'TIER_B');
  assert.strictEqual(calculator.mapTierLevelToBand(TierLevel.HIGH), 'TIER_C');
})();
