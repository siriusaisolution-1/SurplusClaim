import { Body, Controller, Param, Post } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import { ConsentService } from './consent.service';

@Controller('consents')
export class ConsentController {
  constructor(private consentService: ConsentService, private auditService: AuditService) {}

  @Post('cases/:caseRef/present')
  @Roles('TENANT_ADMIN', 'REVIEWER', 'OPS')
  async present(
    @Param('caseRef') caseRef: string,
    @Body() body: { version?: string },
    @CurrentUser() user: any
  ) {
    const response = await this.consentService.presentConsent(user.tenantId, user.sub, caseRef, {
      version: body.version
    });

    return response;
  }

  @Post('sign')
  @Public()
  async sign(@Body() body: { token: string; signerName: string; signerEmail?: string }) {
    const result = await this.consentService.signConsent(body);

    await this.auditService.logAction({
      tenantId: result.consent.tenantId,
      actorId: null,
      action: 'CONSENT_PORTAL_CALLBACK',
      metadata: { caseRef: result.consent.caseRef, consentId: result.consent.id }
    });

    return { status: 'signed', consent: result.consent, artifact: result.artifact };
  }
}
