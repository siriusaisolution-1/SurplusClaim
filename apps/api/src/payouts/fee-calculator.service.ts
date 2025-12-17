import { Injectable } from '@nestjs/common';
import { FeeAgreement, TierLevel } from '@prisma/client';

type FeeTierBand = 'TIER_A' | 'TIER_B' | 'TIER_C';

export interface FeeCalculationInput {
  amountCents: number;
  tierBand: FeeTierBand;
  stateCode?: string;
  agreement?: FeeAgreement | null;
  b2bRateBps?: number;
  contractRateBps?: number;
  referralFeeBps?: number;
  minimumFeeCents?: number;
  stateCaps?: Record<string, number>;
}

export interface FeeCalculationResult {
  feeCents: number;
  appliedRateBps: number;
  appliedCapCents?: number | null;
  appliedMinCents?: number | null;
  rationale: string[];
}

const tierRanges: Record<FeeTierBand, { minBps: number; maxBps: number; label: string }> = {
  TIER_A: { minBps: 1000, maxBps: 1500, label: 'Tier A: 10-15%' },
  TIER_B: { minBps: 1500, maxBps: 2500, label: 'Tier B: 15-25%' },
  TIER_C: { minBps: 2000, maxBps: 3000, label: 'Tier C: 20-30% (referral optional)' }
};

@Injectable()
export class FeeCalculatorService {
  mapTierLevelToBand(tier: TierLevel | null): FeeTierBand {
    if (!tier) return 'TIER_A';
    if (tier === TierLevel.LOW) return 'TIER_A';
    if (tier === TierLevel.MEDIUM) return 'TIER_B';
    return 'TIER_C';
  }

  calculate(input: FeeCalculationInput): FeeCalculationResult {
    if (input.amountCents <= 0) {
      throw new Error('Amount must be positive to calculate a success fee');
    }

    const range = tierRanges[input.tierBand];
    const rationale: string[] = [range.label];

    const baseRate = Math.round((range.minBps + range.maxBps) / 2);
    const contractRate = input.contractRateBps ?? null;
    const b2bRate = input.b2bRateBps ?? input.agreement?.b2bOverride ?? null;
    let appliedRateBps = contractRate ?? b2bRate ?? baseRate;

    if (input.tierBand === 'TIER_C' && input.referralFeeBps) {
      appliedRateBps = input.referralFeeBps;
      rationale.push('Referral fee override applied for Tier C');
    }

    if (contractRate) {
      rationale.push(`Contract-specific rate ${contractRate / 100}% used`);
    } else if (b2bRate) {
      rationale.push(`B2B override ${b2bRate / 100}% applied from agreement`);
    } else {
      rationale.push(`Midpoint of tier band applied at ${appliedRateBps / 100}%`);
    }

    const rawFee = Math.round((input.amountCents * appliedRateBps) / 10000);
    const agreementMin = input.agreement?.minFeeCents ?? null;
    const effectiveMin = Math.max(input.minimumFeeCents ?? 0, agreementMin ?? 0);
    const effectiveCapCandidates = [
      input.agreement?.capAmountCents,
      input.stateCode && input.stateCaps ? input.stateCaps[input.stateCode] : undefined
    ].filter((value) => typeof value === 'number' && value > 0) as number[];
    const effectiveCap =
      effectiveCapCandidates.length > 0
        ? effectiveCapCandidates.reduce((min, value) => Math.min(min, value))
        : null;

    let feeCents = rawFee;
    if (effectiveMin && feeCents < effectiveMin) {
      rationale.push(`Minimum fee enforced at $${(effectiveMin / 100).toFixed(2)}`);
      feeCents = effectiveMin;
    }

    if (effectiveCap && feeCents > effectiveCap) {
      rationale.push(`Cap enforced at $${(effectiveCap / 100).toFixed(2)}`);
      feeCents = effectiveCap;
    }

    if (input.stateCode && input.stateCaps?.[input.stateCode]) {
      rationale.push(`State cap evaluated for ${input.stateCode}`);
    }

    return {
      feeCents,
      appliedRateBps,
      appliedCapCents: effectiveCap ?? null,
      appliedMinCents: effectiveMin || null,
      rationale
    };
  }
}
