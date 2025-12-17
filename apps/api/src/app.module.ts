import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { CasesController } from './cases/cases.controller';
import { CasePackageController } from './cases/case-package.controller';
import { CasesService } from './cases/cases.service';
import { CaseSubmissionController } from './cases/case-submission.controller';
import { CaseSubmissionService } from './cases/case-submission.service';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { RulesController } from './rules/rules.controller';
import { RulesService } from './rules/rules.service';
import { UsersService } from './users/users.service';
import { ConnectorsModule } from './connectors/connectors.module';
import { CommunicationsService } from './communications/communications.service';
import { CommunicationsController } from './communications/communications.controller';
import { ConsentController } from './consent/consent.controller';
import { ConsentService } from './consent/consent.service';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { CasePackageService } from './cases/case-package.service';
import { PayoutsController } from './payouts/payouts.controller';
import { PayoutsService } from './payouts/payouts.service';
import { FeeCalculatorService } from './payouts/fee-calculator.service';
import { LegalSafetyService } from './safety/legal-safety.service';

@Module({
  imports: [ConnectorsModule],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    CasesController,
    CasePackageController,
    CaseSubmissionController,
    AuditController,
    RulesController,
    CommunicationsController,
    ConsentController,
    DocumentsController,
    PayoutsController
  ],
  providers: [
    AuditService,
    AuthService,
    UsersService,
    CasesService,
    CasePackageService,
    RulesService,
    CaseSubmissionService,
    CommunicationsService,
    ConsentService,
    DocumentsService,
    PayoutsService,
    FeeCalculatorService,
    LegalSafetyService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
