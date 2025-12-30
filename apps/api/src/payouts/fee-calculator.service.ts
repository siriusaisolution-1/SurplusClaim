import { Injectable } from '@nestjs/common';
import { TierLevel } from '@prisma/client';

export interface FeeCalculationInput {
  attorneyFeeCents: number;
}

export interface FeeCalculationResult {
  feeCents: number;
  appliedRateBps: number;
  appliedCapCents?: number | null;
  appliedMinCents?: number | null;
  rationale: string[];
}

type FeeTierBand = 'TIER_A' | 'TIER_B' | 'TIER_C';

@Injectable()
export class FeeCalculatorService {
  mapTierLevelToBand(tier: TierLevel | null): FeeTierBand {
    if (!tier) return 'TIER_A';
    if (tier === TierLevel.LOW) return 'TIER_A';
    if (tier === TierLevel.MEDIUM) return 'TIER_B';
    return 'TIER_C';
  }

  calculate(input: FeeCalculationInput): FeeCalculationResult {
    if (input.attorneyFeeCents <= 0) {
      throw new Error('Attorney fee must be positive to calculate a platform fee');
    }

    const appliedRateBps = 1200; // 12%
    const feeCents = Math.round((input.attorneyFeeCents * appliedRateBps) / 10000);
    const rationale = ['Phase 1 CA rule: 12% of realized attorney fee'];

    return {
      feeCents,
      appliedRateBps,
      appliedCapCents: null,
      appliedMinCents: null,
      rationale
    };
  }
}
