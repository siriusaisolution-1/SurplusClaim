import { Injectable, NotFoundException } from '@nestjs/common';
import { ChecklistGenerator, RulesRegistry } from '@surplus/rules';
import type { CaseChecklistContext } from '@surplus/rules';

@Injectable()
export class RulesService {
  private registry = new RulesRegistry();
  private checklist = new ChecklistGenerator(this.registry);

  listJurisdictions() {
    return this.registry.listJurisdictions().filter((jurisdiction) => jurisdiction.enabled);
  }

  getRule(state: string, countyCode: string) {
    const rule = this.registry.getRule(state, countyCode);
    if (!rule) {
      throw new NotFoundException('Rules not found for jurisdiction');
    }
    return rule;
  }

  buildChecklist(context: CaseChecklistContext) {
    const rule = this.getRule(context.state, context.county_code);
    return {
      jurisdiction: {
        state: rule.state,
        county_code: rule.county_code,
        county_name: rule.county_name
      },
      items: this.checklist.generate(context)
    };
  }
}
