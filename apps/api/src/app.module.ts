import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { UsersService } from './users/users.service';

@Module({
  controllers: [HealthController, AuthController, MeController, CasesController],
  providers: [
    AuditService,
    AuthService,
    UsersService,
    CasesService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
