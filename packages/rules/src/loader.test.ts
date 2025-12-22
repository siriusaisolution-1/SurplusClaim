import { describe, expect, it } from 'vitest';

import { ChecklistGenerator } from './checklist';
import { RulesRegistry } from './loader';
import { JurisdictionRuleSchema } from './schemas';

describe('RulesRegistry', () => {
  it('loads jurisdictions from YAML configs', () => {
    const registry = new RulesRegistry();
    const jurisdictions = registry.listJurisdictions();

    expect(jurisdictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'GA', county_code: 'FULTON', enabled: true }),
        expect.objectContaining({ state: 'TX', county_code: 'HARRIS', enabled: false }),
      ])
    );
  });

  it('respects kill-switch feature flags from environment overrides', () => {
    const registry = new RulesRegistry({ disabledJurisdictions: ['GA-FULTON'] });

    expect(registry.getRule('GA', 'FULTON')).toBeUndefined();
    const jurisdictions = registry.listJurisdictions();
    const fulton = jurisdictions.find((item) => item.state === 'GA' && item.county_code === 'FULTON');
    expect(fulton?.enabled).toBe(false);
  });

  it('validates rule shape using zod', () => {
    expect(() =>
      JurisdictionRuleSchema.parse({
        state: 'GA',
        county_code: 'FULTON',
        county_name: 'Fulton County',
        feature_flags: { enabled: true },
        required_documents: [],
        forms: [],
        allowed_email_templates: [],
        procedural: { submission_channels: ['mail'], deadlines: [], addresses: [] },
        fee_schedule: {}
      })
    ).toThrow(/must contain at least 1 element/);
  });
});

describe('ChecklistGenerator', () => {
  it('produces a stable checklist for a given case context', () => {
    const registry = new RulesRegistry();
    const generator = new ChecklistGenerator(registry);

    const checklist = generator.generate({ case_ref: 'GA-FULTON-TEST', state: 'GA', county_code: 'FULTON' });

    expect(checklist).toMatchSnapshot();
  });
});
