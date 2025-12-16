import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';

import { prisma } from '../prisma/prisma.client';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async logAction(params: {
    tenantId: string;
    action: string;
    actorId?: string | null;
    caseId?: string | null;
    caseRef?: string;
    metadata?: Record<string, unknown>;
  }) {
    const hash = createHash('sha256')
      .update(`${params.tenantId}:${params.action}:${Date.now()}:${randomBytes(16).toString('hex')}`)
      .digest('hex');

    try {
      await prisma.auditLog.create({
        data: {
          tenantId: params.tenantId,
          caseId: params.caseId ?? null,
          caseRef: params.caseRef ?? 'AUTH',
          actorId: params.actorId ?? null,
          action: params.action,
          metadata: params.metadata ?? {},
          hash,
          prevHash: null
        }
      });
    } catch (error) {
      this.logger.error('Failed to append to audit log', error as Error);
    }
  }
}
