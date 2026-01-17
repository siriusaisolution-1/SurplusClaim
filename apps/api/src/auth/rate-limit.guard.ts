import { randomUUID } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable
} from '@nestjs/common';

import { StructuredLoggerService } from '../observability/structured-logger.service';

interface RateLimitBucket {
  resetTime: number;
  count: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly limit = parseInt(process.env.TENANT_RATE_LIMIT ?? '120', 10);
  private readonly windowMs = parseInt(process.env.TENANT_RATE_WINDOW_MS ?? '60000', 10);
  private readonly loginGlobalLimit = parseInt(process.env.LOGIN_GLOBAL_RATE_LIMIT ?? '60', 10);
  private readonly loginTenantLimit = parseInt(process.env.LOGIN_TENANT_RATE_LIMIT ?? '20', 10);

  constructor(private readonly logger: StructuredLoggerService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const requestId = request.requestId ?? this.getRequestId(request);
    request.requestId = requestId;
    if (!this.isRateLimitedRoute(request)) {
      return true;
    }
    const tenantKey = this.isLoginRoute(request)
      ? (request.body?.tenantId ?? request.headers['x-tenant-id'] ?? 'anonymous').toString()
      : (request.user?.tenantId ?? request.headers['x-tenant-id'] ?? 'anonymous').toString();
    const now = Date.now();
    const bucketKey = this.isLoginRoute(request) ? `login:${tenantKey}` : tenantKey;
    const bucket = this.buckets.get(bucketKey) ?? { resetTime: now + this.windowMs, count: 0 };

    this.updateBucket(bucket, now);
    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);
    const limit = this.isLoginRoute(request) ? this.loginTenantLimit : this.limit;

    if (this.isLoginRoute(request) && !this.allowLoginGlobal(now)) {
      return this.throwLimitExceeded(response, requestId, tenantKey, 'login_global');
    }

    if (bucket.count > limit) {
      return this.throwLimitExceeded(response, requestId, tenantKey, 'tenant');
    }

    return true;
  }

  private getRequestId(request: any): string {
    const header = request.headers?.['x-request-id'];
    if (typeof header === 'string') {
      return header;
    }
    if (Array.isArray(header) && header[0]) {
      return header[0];
    }
    return randomUUID();
  }

  private updateBucket(bucket: RateLimitBucket, now: number) {
    if (now > bucket.resetTime) {
      bucket.count = 0;
      bucket.resetTime = now + this.windowMs;
    }
  }

  private allowLoginGlobal(now: number): boolean {
    const globalKey = 'login:global';
    const bucket = this.buckets.get(globalKey) ?? { resetTime: now + this.windowMs, count: 0 };
    this.updateBucket(bucket, now);
    bucket.count += 1;
    this.buckets.set(globalKey, bucket);
    return bucket.count <= this.loginGlobalLimit;
  }

  private throwLimitExceeded(
    response: any,
    requestId: string,
    tenantId: string,
    scope: 'tenant' | 'login_global'
  ): boolean {
    const now = Date.now();
    const bucketKey = scope === 'login_global' ? 'login:global' : tenantId;
    const bucket = this.buckets.get(bucketKey) ?? { resetTime: now + this.windowMs, count: 0 };
    const retryAfterSeconds = Math.ceil((bucket.resetTime - now) / 1000);
    response.setHeader('Retry-After', retryAfterSeconds.toString());
    this.logger.warn({
      event: 'rate_limited',
      tenantId,
      requestId,
      caseRef: response.req?.caseRef,
      path: response.req?.originalUrl,
      method: response.req?.method,
      scope,
      retryAfterSeconds
    });
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded',
        retryAfterSeconds,
        scope
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private isLoginRoute(request: any): boolean {
    return request.method === 'POST' && request.path === '/auth/login';
  }

  private isRateLimitedRoute(request: any): boolean {
    const path = request.path ?? '';
    if (request.method !== 'POST') {
      return false;
    }
    if (this.isLoginRoute(request)) {
      return true;
    }
    if (/^\/cases\/[^/]+\/transition$/.test(path)) {
      return true;
    }
    if (/^\/cases\/[^/]+\/documents\/upload$/.test(path)) {
      return true;
    }
    if (/^\/cases\/[^/]+\/package\/generate$/.test(path)) {
      return true;
    }
    return false;
  }
}
