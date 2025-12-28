import { z } from 'zod';

import { validateCaseRef } from './caseRef';

type Primitive = string | number | boolean | null;

const VariableValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const AddressSchema = z
  .object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().length(2),
    postal_code: z.string().regex(/^\d{5}(?:-\d{4})?$/).optional(),
    county_code: z.string().min(2).max(12),
  })
  .strict();

export const NormalizedCaseSchema = z
  .object({
    case_ref: z.string().refine((value) => validateCaseRef(value), {
      message: 'Invalid case reference',
    }),
    state: z.string().length(2),
    county_code: z.string().min(2).max(12),
    source_system: z.string().min(1),
    filed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    property_address: AddressSchema.optional(),
    parties: z
      .array(
        z
          .object({
            role: z.enum(['plaintiff', 'defendant', 'owner', 'other']),
            name: z.string().min(1),
            contact: z.string().optional(),
          })
          .strict()
      )
      .default([]),
    amounts: z
      .array(
        z
          .object({
            type: z.string().min(1),
            amount: z.number().nonnegative(),
            currency: z.string().length(3).default('USD'),
          })
          .strict()
      )
      .default([]),
    status: z.enum(['open', 'pending', 'closed', 'unknown']).default('unknown'),
    metadata: z.record(z.string(), z.any()).optional(),
    raw: z.record(z.string(), z.any()).optional(),
  })
  .strict();

export const EmailPlanSchema = z
  .object({
    template_id: z.string().min(1),
    variables: z.record(VariableValueSchema).default({}),
    send_at: z.preprocess(
      (value) => (typeof value === 'string' || value instanceof Date ? new Date(value) : value),
      z.date()
    ),
    channel: z.enum(['email', 'sms', 'push']),
  })
  .strict();

const ActorSchema = z
  .object({
    type: z.enum(['system', 'user', 'service']),
    id: z.string().min(1),
    email: z.string().email().optional(),
  })
  .strict();

const TargetSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

export const AuditEventSchema = z
  .object({
    event: z.string().min(1),
    occurred_at: z.coerce.date(),
    actor: ActorSchema,
    target: TargetSchema.optional(),
    request_id: z.string().optional(),
    context: z.record(z.string(), z.any()).optional(),
    payload: z.record(z.string(), z.any()).optional(),
  })
  .strict();

export type NormalizedCase = z.infer<typeof NormalizedCaseSchema>;
export type EmailPlan = z.infer<typeof EmailPlanSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value as Primitive | Record<string, unknown>;
}

export type CanonicalAuditEvent = AuditEvent & {
  occurred_at: Date;
  context?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

export function canonicalizeAuditEvent(input: unknown): CanonicalAuditEvent {
  const parsed = AuditEventSchema.parse(input);

  return {
    ...parsed,
    occurred_at: parsed.occurred_at,
    context: parsed.context ? (sortKeys(parsed.context) as Record<string, unknown>) : undefined,
    payload: parsed.payload ? (sortKeys(parsed.payload) as Record<string, unknown>) : undefined,
  };
}
