import { randomUUID } from 'node:crypto';

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { redactPII } from './redaction';
import { StructuredLoggerService } from './structured-logger.service';

function extractCaseRef(request: any): string | undefined {
  return request.params?.caseRef ?? request.body?.caseRef ?? request.query?.caseRef;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: StructuredLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();

    const requestId = request.requestId ?? request.headers['x-request-id'] ?? randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    const caseRef = extractCaseRef(request);
    const tenantId = request.user?.tenantId ?? request.headers['x-tenant-id'];
    const startedAt = Date.now();

    this.logger.log({
      event: 'request_received',
      requestId,
      path: request.originalUrl,
      method: request.method,
      tenantId,
      caseRef,
      body: redactPII(request.body)
    });

    return next.handle().pipe(
      tap((data) => {
        this.logger.log({
          event: 'request_completed',
          requestId,
          durationMs: Date.now() - startedAt,
          statusCode: response.statusCode,
          tenantId,
          caseRef,
          response: redactPII(data)
        });
      }),
      catchError((error) => {
        this.logger.error(
          {
            event: 'request_failed',
            requestId,
            durationMs: Date.now() - startedAt,
            tenantId,
            caseRef,
            message: error?.message ?? 'Unhandled error'
          },
          error?.stack
        );
        throw error;
      })
    );
  }
}
