import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser, Roles } from '../auth/auth.decorators';
import { PayoutsService } from './payouts.service';

@Controller('cases/:caseRef/payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get()
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'B2B_CLIENT')
  async list(@Param('caseRef') caseRef: string, @CurrentUser() user: any) {
    return this.payoutsService.listForCase(user.tenantId, caseRef);
  }

  @Post('confirm')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS', 'B2B_CLIENT')
  @UseInterceptors(FileInterceptor('evidence'))
  async confirm(
    @Param('caseRef') caseRef: string,
    @UploadedFile() evidence: Express.Multer.File,
    @Body() body: any,
    @CurrentUser() user: any
  ) {
    const amountRaw = body.amountCents ?? body.amount_cents ?? body.amount;
    const parsedAmount = amountRaw ? parseInt(amountRaw.toString(), 10) : null;
    if (!parsedAmount || Number.isNaN(parsedAmount)) {
      throw new BadRequestException('amountCents is required');
    }

    const attorneyFeeRaw =
      body.attorneyFeeCents ?? body.attorney_fee_cents ?? body.attorneyFee ?? body.attorney_fee;
    const parsedAttorneyFee = attorneyFeeRaw ? parseInt(attorneyFeeRaw.toString(), 10) : null;
    if (!parsedAttorneyFee || Number.isNaN(parsedAttorneyFee)) {
      throw new BadRequestException('attorneyFeeCents is required');
    }

    const closeCase = body.closeCase === 'true' || body.closeCase === true || body.close_case === 'true';

    return this.payoutsService.confirmPayout({
      tenantId: user.tenantId,
      actorId: user.sub,
      caseRef,
      amountCents: parsedAmount,
      attorneyFeeCents: parsedAttorneyFee,
      currency: body.currency ?? 'USD',
      reference: body.reference ?? undefined,
      evidenceFile: evidence,
      note: body.note ?? undefined,
      closeCase
    });
  }
}
