import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'REVIEWER' | 'OPS' | 'B2B_CLIENT' | 'READ_ONLY';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthenticatedUser {
  sub: string;
  tenantId: string;
  role: Role;
  email: string;
  fullName: string;
}

export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as AuthenticatedUser;
});
