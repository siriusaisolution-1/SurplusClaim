export const UPL_DISCLAIMER =
  'This product provides structured, non-legal guidance only. Nothing here constitutes legal advice or creates an attorney-client relationship.';

export const AI_OUTPUT_RULES = {
  rationaleMessages: new Set<string>([
    'Probate flag detected',
    'Heirs or next-of-kin investigation required',
    'Title issue noted by intake',
    'Escalation keywords detected (probate/heirs/title dispute)',
    'Defaulted to Tier A due to no escalation signals',
    'Intermediate handling recommended before client contact',
    'Tier C requires escalation to partner'
  ])
};

export const UPL_UI_NOTICE =
  'For compliance: outputs are structured only, require human review, and are not legal advice.';
