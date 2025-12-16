import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';

import { AuditService } from '../audit/audit.service';
import { IS_PUBLIC_KEY, ROLES_KEY, AuthenticatedUser, Role } from './auth.decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private auditService: AuditService) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token');
    }

    const token = authHeader.replace('Bearer ', '');

    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET ?? 'local-dev-secret') as AuthenticatedUser;
      request.user = payload;

      const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass()
      ]);

      if (requiredRoles && !requiredRoles.includes(payload.role)) {
        void this.auditService.logAction({
          tenantId: payload.tenantId,
          actorId: payload.sub,
          action: 'PERMISSION_DENIED',
          caseRef: 'AUTH',
          metadata: {
            reason: 'role_denied',
            required: requiredRoles,
            actual: payload.role
          }
        });
        throw new ForbiddenException('Insufficient role');
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
