import { describe, expect, it } from 'vitest';

import { templateRegistry } from './communications/templates';
import { generateCaseRef } from './caseRef';
import { AI_OUTPUT_RULES, UPL_DISCLAIMER, UPL_UI_NOTICE } from './upl';

const VALID_CASE_REF = generateCaseRef({ state: 'GA', countycode: 'FUL', date: '2024-01-01' });

const requiredVariables: Record<string, string> = {
  recipient_name: 'Test User',
  recipient_email: 'user@example.test',
  reply_to: 'reply@example.test',
  consent_link: 'https://example.test/consent',
  case_ref: VALID_CASE_REF,
  missing_items: 'photo ID',
  status_note: 'processing',
  deadline_name: 'filing deadline',
  deadline_date: '2024-12-31',
};

function buildVariables(variableNames: string[]) {
  const variables: Record<string, string> = {};
  variableNames.forEach((name) => {
    variables[name] = requiredVariables[name] ?? 'placeholder';
  });
  return variables;
}

describe('UPL guardrails', () => {
  it('injects the disclaimer into every template render', () => {
    const templates = templateRegistry.list();

    templates.forEach((tpl) => {
      const variables = buildVariables(Object.keys(tpl.variables));
      const rendered = templateRegistry.render(tpl.id, variables, tpl.version);
      expect(rendered.disclaimer).toBe(UPL_DISCLAIMER);
      expect(rendered.body.includes(UPL_DISCLAIMER)).toBe(true);
    });
  });

  it('exposes AI rationale allowlist for structured outputs', () => {
    expect(AI_OUTPUT_RULES.rationaleMessages.size).toBeGreaterThan(0);
    expect(AI_OUTPUT_RULES.rationaleMessages.has('Probate flag detected')).toBe(true);
  });

  it('exports a UI notice for client rendering', () => {
    expect(UPL_UI_NOTICE.toLowerCase()).toContain('not legal advice');
  });
});
