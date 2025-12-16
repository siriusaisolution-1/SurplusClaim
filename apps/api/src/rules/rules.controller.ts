import { Controller, Get, Param, Query } from '@nestjs/common';

import { CurrentUser, Roles } from '../auth/auth.decorators';
import { DocumentsService } from '../documents/documents.service';
import { RulesService } from './rules.service';

@Controller('rules')
export class RulesController {
  constructor(
    private readonly rulesService: RulesService,
    private readonly documentsService: DocumentsService
  ) {}

  @Get('jurisdictions')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  listJurisdictions() {
    return { jurisdictions: this.rulesService.listJurisdictions() };
  }

  @Get(':state/:countyCode')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  async getRules(
    @Param('state') state: string,
    @Param('countyCode') countyCode: string,
    @Query('case_ref') caseRef?: string,
    @CurrentUser() user?: any
  ) {
    const rule = this.rulesService.getRule(state, countyCode);
    const baseChecklist = caseRef
      ? this.rulesService.buildChecklist({ case_ref: caseRef, state, county_code: countyCode })
      : null;

    const checklist =
      caseRef && baseChecklist && user
        ? {
            ...baseChecklist,
            items: await this.documentsService.mergeChecklistWithDocuments(
              user.tenantId,
              caseRef,
              baseChecklist.items
            )
          }
        : baseChecklist;

    return { rule, checklist };
  }
}
