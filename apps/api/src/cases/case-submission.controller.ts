import { Body, Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser, Roles } from '../auth/auth.decorators';
import { CaseSubmissionService } from './case-submission.service';

@Controller('cases/:caseRef/submission')
export class CaseSubmissionController {
  constructor(private readonly submissionService: CaseSubmissionService) {}

  @Post()
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS')
  @UseInterceptors(FileInterceptor('file'))
  async record(
    @Param('caseRef') caseRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('submittedAt') submittedAt: string | undefined,
    @Body('channel') channel: string | undefined,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: any
  ) {
    const result = await this.submissionService.recordSubmission({
      tenantId: user.tenantId,
      actorId: user.sub,
      caseRef,
      file,
      submittedAt,
      channel,
      notes
    });

    return result;
  }
}

