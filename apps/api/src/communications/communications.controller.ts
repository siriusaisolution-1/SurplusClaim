import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { Roles, CurrentUser } from '../auth/auth.decorators';
import { CommunicationsService } from './communications.service';

@Controller()
export class CommunicationsController {
  constructor(private communicationsService: CommunicationsService) {}

  @Get('communications/templates')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  listTemplates() {
    return { templates: this.communicationsService.listTemplates() };
  }

  @Post('cases/:caseRef/communications/plan')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS')
  plan(@Param('caseRef') caseRef: string, @Body() body: any, @CurrentUser() user: any) {
    return this.communicationsService.planCommunication(user.tenantId, caseRef, {
      templateId: body.templateId,
      variables: body.variables ?? {},
      sendAt: body.sendAt
    });
  }

  @Post('cases/:caseRef/communications/send')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS')
  send(@Param('caseRef') caseRef: string, @Body() body: any, @CurrentUser() user: any) {
    return this.communicationsService.sendCommunication(user.tenantId, user.sub, caseRef, {
      templateId: body.templateId,
      variables: body.variables ?? {},
      sendAt: body.sendAt,
      autoSend: body.autoSend === true
    });
  }

  @Get('cases/:caseRef/communications')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  history(@Param('caseRef') caseRef: string, @CurrentUser() user: any) {
    return this.communicationsService.listCaseCommunications(user.tenantId, caseRef);
  }
}
