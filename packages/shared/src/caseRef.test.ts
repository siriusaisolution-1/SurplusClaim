import { describe, expect, it } from 'vitest';

import {
  extractCaseRefFromText,
  generateCaseRef,
  parseCaseRef,
  validateCaseRef,
} from './caseRef';
import { AuditEventSchema, EmailPlanSchema, NormalizedCaseSchema, canonicalizeAuditEvent } from './schemas';

describe('case reference generation', () => {
  it('creates unique values across many generations', () => {
    const refs = new Set<string>();
    const date = new Date('2025-12-15');

    for (let i = 0; i < 2000; i += 1) {
      const ref = generateCaseRef({ state: 'CA', countycode: 'ALAM', date });
      expect(validateCaseRef(ref)).toBe(true);
      expect(refs.has(ref)).toBe(false);
      refs.add(ref);
    }
  });

  it('validates and parses correctly', () => {
    const caseRef = generateCaseRef({ state: 'NY', countycode: 'KINGS', date: '2025-02-02' });

    expect(validateCaseRef(caseRef)).toBe(true);

    const parsed = parseCaseRef(caseRef);
    expect(parsed.state).toBe('NY');
    expect(parsed.countyCode).toBe('KINGS');
    expect(parsed.date).toBe('20250202');
    expect(parsed.random).toHaveLength(6);
  });

  it('fails validation when check digit is wrong', () => {
    const caseRef = generateCaseRef({ state: 'IL', countycode: 'COOK', date: '2024-01-01' });
    const invalid = `${caseRef.slice(0, -1)}Z`;

    expect(validateCaseRef(invalid)).toBe(false);
    expect(() => parseCaseRef(invalid)).toThrowError('Invalid check digit');
  });

  it('extracts references from noisy text', () => {
    const caseRef = generateCaseRef({ state: 'CA', countycode: 'ALAM', date: '2025-12-15' });
    const subject = `[${caseRef}] Status update`;
    const found = extractCaseRefFromText(subject);

    expect(found).toBe(caseRef);
    expect(validateCaseRef(found ?? '')).toBe(true);
  });
});

describe('shared schemas', () => {
  it('parses a normalized case payload', () => {
    const caseRef = generateCaseRef({ state: 'CA', countycode: 'ALAM', date: '2025-12-15' });
    const parsed = NormalizedCaseSchema.parse({
      case_ref: caseRef,
      state: 'CA',
      county_code: 'ALAM',
      source_system: 'scraper',
      filed_at: '2025-01-05',
      property_address: {
        line1: '123 Main St',
        city: 'Oakland',
        state: 'CA',
        county_code: 'ALAM',
        postal_code: '94607',
      },
      parties: [
        { role: 'plaintiff', name: 'County of Alameda' },
        { role: 'defendant', name: 'John Doe' },
      ],
      amounts: [{ type: 'surplus', amount: 1000 }],
      status: 'open',
    });

    expect(parsed.case_ref).toBe(caseRef);
    expect(parsed.parties).toHaveLength(2);
    expect(parsed.amounts[0].currency).toBe('USD');
  });

  it('validates email plan data and coercion', () => {
    const plan = EmailPlanSchema.parse({
      template_id: 'welcome',
      variables: { first_name: 'Ada', amount: 50 },
      send_at: '2026-01-01T05:00:00Z',
      channel: 'email',
    });

    expect(plan.send_at instanceof Date).toBe(true);
    expect(plan.variables.amount).toBe(50);
  });

  it('canonicalizes audit events with sorted payload', () => {
    const canonical = canonicalizeAuditEvent({
      event: 'case.created',
      occurred_at: '2026-04-01T10:00:00Z',
      actor: { type: 'system', id: 'scraper-service' },
      payload: { b: 2, a: 1 },
    });

    expect(canonical.occurred_at).toBeInstanceOf(Date);
    expect((canonical.occurred_at as Date).toISOString()).toBe('2026-04-01T10:00:00.000Z');
    expect(Object.keys(canonical.payload ?? {})).toEqual(['a', 'b']);
    expect(AuditEventSchema.parse(canonical)).toBeTruthy();
  });
});
