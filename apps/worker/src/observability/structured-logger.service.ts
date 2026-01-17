import { Injectable, LoggerService } from '@nestjs/common';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';
type LogPayload = {
  event?: string;
  requestId?: string | null;
  tenantId?: string | null;
  caseRef?: string | null;
  [key: string]: unknown;
};

@Injectable()
export class StructuredLoggerService implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug?(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, trace?: string) {
    const base = typeof message === 'object' && message !== null ? (message as LogPayload) : {};
    const { event, requestId = null, tenantId = null, caseRef = null, ...rest } = base;
    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      event: event ?? (typeof message === 'string' ? context ?? 'log' : 'log'),
      requestId,
      tenantId,
      caseRef,
      message: typeof message === 'string' ? message : undefined,
      context,
      data: typeof message === 'string' ? undefined : rest,
      ...(trace ? { trace } : {})
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }
}
