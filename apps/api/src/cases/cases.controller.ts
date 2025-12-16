import { Controller, Get, NotFoundException, Param } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { CasesService } from './cases.service';

@Controller('cases')
export class CasesController {
  constructor(private casesService: CasesService, private auditService: AuditService) {}

  @Get(':caseRef')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS')
  async getCase(@Param('caseRef') caseRef: string, @CurrentUser() user: any) {
    const caseRecord = await this.casesService.findByCaseRef(user.tenantId, caseRef);

    if (!caseRecord) {
      await this.auditService.logAction({
        tenantId: user.tenantId,
        actorId: user.sub,
        caseRef,
        action: 'PERMISSION_DENIED',
        metadata: { reason: 'cross_tenant_or_missing' }
      });
      throw new NotFoundException('Case not found');
    }

    return {
      id: caseRecord.id,
      tenantId: caseRecord.tenantId,
      caseRef: caseRecord.caseRef,
      status: caseRecord.status,
      reviewer: caseRecord.assignedReviewer
        ? { id: caseRecord.assignedReviewer.id, email: caseRecord.assignedReviewer.email }
        : null
    };
  }
}
