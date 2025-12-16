import { Controller, Get, Param, Query } from '@nestjs/common';

import { Roles } from '../auth/auth.decorators';
import { RulesService } from './rules.service';

@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get('jurisdictions')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  listJurisdictions() {
    return { jurisdictions: this.rulesService.listJurisdictions() };
  }

  @Get(':state/:countyCode')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  getRules(
    @Param('state') state: string,
    @Param('countyCode') countyCode: string,
    @Query('case_ref') caseRef?: string
  ) {
    const rule = this.rulesService.getRule(state, countyCode);
    const checklist = caseRef
      ? this.rulesService.buildChecklist({ case_ref: caseRef, state, county_code: countyCode })
      : null;

    return { rule, checklist };
  }
}
