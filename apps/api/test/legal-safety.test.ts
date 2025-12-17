// @ts-nocheck
import { AI_OUTPUT_RULES, UPL_DISCLAIMER } from '../../../packages/shared/src/upl';

import { LegalSafetyService } from '../src/safety/legal-safety.service';

const legalSafety = new LegalSafetyService();

const sampleSuggestion = {
  tier: 'TIER_A',
  mappedTierLevel: 'LOW',
  rationale: Array.from(AI_OUTPUT_RULES.rationaleMessages.values()).slice(0, 2),
  confidence: 0.58,
  escalates: false,
  signalsUsed: ['probate_flag'],
};

function expectThrow(fn: () => void, message: string) {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
  }
  if (!threw) {
    throw new Error(message);
  }
}

legalSafety.validateStructuredSuggestion(sampleSuggestion);
if (legalSafety.disclaimer !== UPL_DISCLAIMER) {
  throw new Error('Disclaimer must match shared constant');
}

expectThrow(
  () => legalSafety.validateStructuredSuggestion({ ...sampleSuggestion, rationale: ['free form legal opinion'] }),
  'Unvalidated rationale should be rejected'
);

if (legalSafety.validateDocType('claimant-id') !== 'claimant-id') {
  throw new Error('Doc type validation failed');
}

expectThrow(
  () => legalSafety.validateDocType('claimant-id<script>', ['claimant-id']),
  'Script-like doc types must be blocked'
);

expectThrow(() => legalSafety.validateDocType('unknown', ['claimant-id']), 'Unexpected doc types must be blocked');

console.log('Legal safety tests passed');
