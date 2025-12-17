import { Injectable, LoggerService } from '@nestjs/common';

import { redactPII } from './redaction';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

@Injectable()
export class StructuredLoggerService implements LoggerService {
  log(message: any, context?: string): void {
    this.write('info', message, context);
  }

  error(message: any, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: any, context?: string): void {
    this.write('warn', message, context);
  }

  debug?(message: any, context?: string): void {
    this.write('debug', message, context);
  }

  private write(level: LogLevel, message: any, context?: string, trace?: string) {
    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : undefined,
      context,
      data: typeof message === 'string' ? undefined : redactPII(message),
      ...(trace ? { trace } : {})
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }
}
