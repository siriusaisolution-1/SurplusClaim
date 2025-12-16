import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';

import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get('verify')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  async verify(@CurrentUser() user: any) {
    return this.auditService.verifyChain(user.tenantId);
  }

  @Get('export')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  async export(@Query('case_ref') caseRef: string, @CurrentUser() user: any, @Res() res: Response) {
    if (!caseRef) {
      throw new BadRequestException('case_ref is required');
    }

    const body = await this.auditService.exportCaseAudit(user.tenantId, caseRef);
    res.setHeader('Content-Type', 'application/jsonl');
    return res.send(body);
  }
}
