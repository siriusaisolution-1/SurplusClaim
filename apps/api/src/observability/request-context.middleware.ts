import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

function extractCaseRef(request: Request): string | undefined {
  const fromParams = request.params?.caseRef;
  if (fromParams) return fromParams;
  const fromBody = (request.body as { caseRef?: string } | undefined)?.caseRef;
  if (fromBody) return fromBody;
  const fromQuery = (request.query as { caseRef?: string } | undefined)?.caseRef;
  if (fromQuery) return fromQuery;

  const match = request.path.match(/^\/cases\/([^/]+)/);
  return match?.[1];
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    const incomingRequestId = request.headers['x-request-id'];
    const requestId =
      typeof incomingRequestId === 'string'
        ? incomingRequestId
        : Array.isArray(incomingRequestId)
          ? incomingRequestId[0]
          : randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    request.caseRef = extractCaseRef(request);
    next();
  }
}
