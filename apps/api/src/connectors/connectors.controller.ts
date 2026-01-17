import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser, Roles } from '../auth/auth.decorators';
import { ConnectorsService } from './connectors.service';

@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get('status')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  async getStatus(@CurrentUser() user: any) {
    return { connectors: await this.connectors.getStatus(user.tenantId) };
  }

  @Get('runs')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY')
  async listRuns(
    @CurrentUser() user: any,
    @Query('connector_id') connectorId?: string,
    @Query('case_ref') caseRef?: string,
    @Query('limit') limit?: string
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return {
      runs: await this.connectors.listRuns(user.tenantId, {
        connectorId,
        caseRef,
        limit: parsedLimit && !Number.isNaN(parsedLimit) ? parsedLimit : undefined
      })
    };
  }
}
