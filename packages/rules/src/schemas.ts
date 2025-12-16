import path from 'path';
import { z } from 'zod';

export const AddressSchema = z
  .object({
    name: z.string().min(1),
    attention: z.string().optional(),
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().length(2),
    postal_code: z.string().regex(/^\d{5}(?:-\d{4})?$/),
  })
  .strict();

export const DeadlineSchema = z
  .object({
    name: z.string().min(1),
    timeline: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();

export const ProceduralMetadataSchema = z
  .object({
    submission_channels: z.array(z.string().min(1)).min(1),
    deadlines: z.array(DeadlineSchema).default([]),
    addresses: z.array(AddressSchema).default([]),
  })
  .strict();

export const RequiredDocumentSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    required: z.boolean().default(true),
    conditions: z.string().optional(),
  })
  .strict();

export const FormSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
    description: z.string().optional(),
  })
  .strict();

export const EmailTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

export const FeeScheduleSchema = z
  .object({
    min_fee_cents: z.number().int().nonnegative().optional(),
    max_fee_cents: z.number().int().positive().optional(),
  })
  .refine(
    (value) =>
      value.min_fee_cents === undefined ||
      value.max_fee_cents === undefined ||
      value.min_fee_cents <= value.max_fee_cents,
    { message: 'min_fee_cents cannot exceed max_fee_cents' }
  );

export const JurisdictionRuleSchema = z
  .object({
    state: z.string().length(2),
    county_code: z.string().min(2),
    county_name: z.string().min(1),
    feature_flags: z
      .object({
        enabled: z.boolean(),
        notes: z.string().optional(),
      })
      .strict(),
    required_documents: z.array(RequiredDocumentSchema).min(1),
    forms: z.array(FormSchema).default([]),
    procedural: ProceduralMetadataSchema,
    allowed_email_templates: z.array(EmailTemplateSchema).default([]),
    fee_schedule: FeeScheduleSchema,
  })
  .strict();

export type JurisdictionRule = z.infer<typeof JurisdictionRuleSchema>;
export type RequiredDocument = z.infer<typeof RequiredDocumentSchema>;
export type ChecklistItem = RequiredDocument & {
  jurisdiction: { state: string; county_code: string; county_name: string };
  type: 'document' | 'form';
};

export const RuleFileSchema = z.object({ filePath: z.string().min(1) }).strict();

export function getDefaultRulesDirectory(currentDir: string) {
  return path.resolve(currentDir, '..', 'states');
}
