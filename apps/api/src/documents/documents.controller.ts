import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import multer, { type FileFilterCallback, type Options as MulterOptions } from 'multer';

import { CurrentUser, Roles } from '../auth/auth.decorators';
import { DocumentStatus, DocumentsService } from './documents.service';
import { MAX_UPLOAD_BYTES, validateFileInput } from './upload.config';

const fileFilter = (_req: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
  try {
    validateFileInput(file);
    (callback as () => void)();
  } catch (error) {
    if (error instanceof BadRequestException) {
      callback(error);
      return;
    }
    callback(new BadRequestException('Invalid file upload'));
  }
};

@Controller('cases/:caseRef/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'READ_ONLY', 'B2B_CLIENT')
  async list(@Param('caseRef') caseRef: string, @CurrentUser() user: any) {
    return this.documentsService.listDocuments(user.tenantId, caseRef);
  }

  @Post('upload')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'B2B_CLIENT')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter
    } satisfies MulterOptions)
  )
  async upload(
    @Param('caseRef') caseRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('docType') docType: string | undefined,
    @CurrentUser() user: any
  ) {
    return this.documentsService.uploadDocument({
      tenantId: user.tenantId,
      actorId: user.sub,
      caseRef,
      file,
      docType: docType && docType.length > 0 ? docType : undefined
    });
  }

  @Post(':documentId/review')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS')
  async review(
    @Param('caseRef') caseRef: string,
    @Param('documentId') documentId: string,
    @Body() body: { status: DocumentStatus; note?: string; docType?: string },
    @CurrentUser() user: any
  ) {
    const allowedStatuses: DocumentStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!allowedStatuses.includes(body.status)) {
      throw new BadRequestException('Invalid status');
    }

    return this.documentsService.reviewDocument({
      tenantId: user.tenantId,
      actorId: user.sub,
      caseRef,
      documentId,
      status: body.status,
      note: body.note,
      docType: body.docType
    });
  }
}
