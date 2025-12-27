// apps/api/src/fees/fee-calculator.ts

export type FeePolicy = {
  feeRateBps: number; // e.g. 1200 = 12%
  minFeeCents?: number | null;
  capAmountCents?: number | null;
};

export type FeeCalculationInput = {
  payoutAmountCents: number;
  policy: FeePolicy;
};

export type FeeCalculationResult = {
  payoutAmountCents: number;
  feeRateBps: number;
  feeCents: number;
  minFeeApplied: boolean;
  capApplied: boolean;
};

/**
 * Fee calculation rules (explicit and deterministic):
 * 1) base = round(payout * bps / 10_000)
 * 2) if minFeeCents provided -> fee = max(base, minFeeCents)
 * 3) if capAmountCents provided -> fee = min(fee, capAmountCents)
 */
export function calculateFee(input: FeeCalculationInput): FeeCalculationResult {
  const { payoutAmountCents, policy } = input;

  if (!Number.isInteger(payoutAmountCents) || payoutAmountCents < 0) {
    throw new Error(`Invalid payoutAmountCents: ${payoutAmountCents}`);
  }

  if (!Number.isInteger(policy.feeRateBps) || policy.feeRateBps < 0) {
    throw new Error(`Invalid feeRateBps: ${policy.feeRateBps}`);
  }

  const raw = Math.round((payoutAmountCents * policy.feeRateBps) / 10_000);

  let feeCents = raw;
  let minFeeApplied = false;
  let capApplied = false;

  const minFee = policy.minFeeCents ?? null;
  if (minFee !== null) {
    if (!Number.isInteger(minFee) || minFee < 0) {
      throw new Error(`Invalid minFeeCents: ${minFee}`);
    }
    if (feeCents < minFee) {
      feeCents = minFee;
      minFeeApplied = true;
    }
  }

  const cap = policy.capAmountCents ?? null;
  if (cap !== null) {
    if (!Number.isInteger(cap) || cap < 0) {
      throw new Error(`Invalid capAmountCents: ${cap}`);
    }
    if (feeCents > cap) {
      feeCents = cap;
      capApplied = true;
    }
  }

  return {
    payoutAmountCents,
    feeRateBps: policy.feeRateBps,
    feeCents,
    minFeeApplied,
    capApplied,
  };
}
