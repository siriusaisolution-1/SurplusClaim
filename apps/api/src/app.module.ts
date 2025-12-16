import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
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

@Module({
  imports: [ConnectorsModule],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    CasesController,
    AuditController,
    RulesController,
    CommunicationsController,
    ConsentController
  ],
  providers: [
    AuditService,
    AuthService,
    UsersService,
    CasesService,
    RulesService,
    CommunicationsService,
    ConsentService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
