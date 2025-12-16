import { z } from 'zod';

import { RulesRegistry } from './loader';
import { ChecklistItem } from './schemas';

export const CaseChecklistContextSchema = z
  .object({
    case_ref: z.string().min(1),
    state: z.string().length(2),
    county_code: z.string().min(2),
  })
  .strict();

export type CaseChecklistContext = z.infer<typeof CaseChecklistContextSchema>;

export class ChecklistGenerator {
  constructor(private registry: RulesRegistry) {}

  generate(context: CaseChecklistContext): ChecklistItem[] {
    const parsed = CaseChecklistContextSchema.parse(context);
    return this.registry.getChecklistItems(parsed.state, parsed.county_code);
  }
}
