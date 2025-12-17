import { Controller, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';

import { CurrentUser, Roles } from '../auth/auth.decorators';
import { CasePackageService } from './case-package.service';

@Controller('cases/:caseRef/package')
export class CasePackageController {
  constructor(private readonly casePackageService: CasePackageService) {}

  @Post('generate')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'B2B_CLIENT')
  async generate(@Param('caseRef') caseRef: string, @CurrentUser() user: any) {
    return this.casePackageService.generatePackage(user.tenantId, user.sub, caseRef);
  }

  @Get('download')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY', 'B2B_CLIENT')
  async download(
    @Param('caseRef') caseRef: string,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response
  ) {
    const latest = await this.casePackageService.getLatestPackage(user.tenantId, user.sub, caseRef);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${latest.filename}"`
    });
    res.setHeader('Content-Length', latest.buffer.length);

    return new StreamableFile(latest.buffer);
  }
}
