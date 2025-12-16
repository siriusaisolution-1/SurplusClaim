import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { CaseTransitionInput, CasesService, CreateCaseInput } from './cases.service';

@Controller('cases')
export class CasesController {
  constructor(private casesService: CasesService, private auditService: AuditService) {}

  @Get()
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  async listCases(
    @CurrentUser() user: any,
    @Query('status') status?: CaseStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ) {
    const parsedStatus = status && Object.values(CaseStatus).includes(status) ? status : undefined;
    const response = await this.casesService.listCases(user.tenantId, {
      status: parsedStatus,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined
    });

    return {
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
      cases: response.data.map((item) => ({
        id: item.id,
        caseRef: item.caseRef,
        status: item.status,
        tierSuggested: item.tierSuggested,
        tierConfirmed: item.tierConfirmed,
        assignedReviewer: item.assignedReviewer
          ? { id: item.assignedReviewer.id, email: item.assignedReviewer.email }
          : null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
    };
  }

  @Post()
  @Roles('TENANT_ADMIN', 'OPS', 'REVIEWER')
  async createCase(@Body() body: CreateCaseInput, @CurrentUser() user: any) {
    const newCase = await this.casesService.createCase(user.tenantId, user.sub, body);

    return {
      case: newCase,
      allowedTransitions: this.casesService.getAllowedTransitions(newCase.status)
    };
  }

  @Get(':caseRef')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  async getCase(@Param('caseRef') caseRef: string, @CurrentUser() user: any) {
    const details = await this.casesService.getCaseWithTimeline(user.tenantId, caseRef);

    if (!details) {
      await this.auditService.logAction({
        tenantId: user.tenantId,
        actorId: user.sub,
        caseRef,
        action: 'PERMISSION_DENIED',
        metadata: { reason: 'cross_tenant_or_missing' }
      });
      throw new NotFoundException('Case not found');
    }

    await this.auditService.logAction({
      tenantId: user.tenantId,
      actorId: user.sub,
      caseRef,
      caseId: details.caseRecord.id,
      action: 'CASE_VIEWED',
      metadata: { viewerRole: user.role }
    });

    return {
      case: {
        id: details.caseRecord.id,
        tenantId: details.caseRecord.tenantId,
        caseRef: details.caseRecord.caseRef,
        status: details.caseRecord.status,
        tierSuggested: details.caseRecord.tierSuggested,
        tierConfirmed: details.caseRecord.tierConfirmed,
        reviewer: details.caseRecord.assignedReviewer
          ? { id: details.caseRecord.assignedReviewer.id, email: details.caseRecord.assignedReviewer.email }
          : null,
        createdAt: details.caseRecord.createdAt,
        updatedAt: details.caseRecord.updatedAt
      },
      timeline: details.events,
      auditTrail: details.auditTrail,
      allowedTransitions: details.allowedTransitions
    };
  }

  @Post(':caseRef/transition')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS')
  async transitionCase(
    @Param('caseRef') caseRef: string,
    @Body() body: CaseTransitionInput,
    @CurrentUser() user: any
  ) {
    if (!Object.values(CaseStatus).includes(body.toState)) {
      throw new NotFoundException('Requested target state is invalid');
    }

    const updatedCase = await this.casesService.transitionCase(user.tenantId, user.sub, caseRef, body);

    return updatedCase;
  }
}
