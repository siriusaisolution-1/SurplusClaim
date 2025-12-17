import { randomUUID } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable, TooManyRequestsException } from '@nestjs/common';

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

  constructor(private readonly logger: StructuredLoggerService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const requestId = request.requestId ?? request.headers['x-request-id'] ?? randomUUID();
    request.requestId = requestId;
    const tenantKey = (request.user?.tenantId ?? request.headers['x-tenant-id'] ?? 'anonymous').toString();
    const now = Date.now();
    const bucket = this.buckets.get(tenantKey) ?? { resetTime: now + this.windowMs, count: 0 };

    if (now > bucket.resetTime) {
      bucket.count = 0;
      bucket.resetTime = now + this.windowMs;
    }

    bucket.count += 1;
    this.buckets.set(tenantKey, bucket);

    if (bucket.count > this.limit) {
      const retryAfterSeconds = Math.ceil((bucket.resetTime - now) / 1000);
      response.setHeader('Retry-After', retryAfterSeconds.toString());
      this.logger.warn({
        event: 'rate_limited',
        tenantId: tenantKey,
        requestId,
        retryAfterSeconds
      });
      throw new TooManyRequestsException('Rate limit exceeded for tenant');
    }

    return true;
  }
}
