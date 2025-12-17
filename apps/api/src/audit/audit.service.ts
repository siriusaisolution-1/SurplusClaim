import { Injectable } from '@nestjs/common';
import { AuditEngine, VerificationRange, VerificationResult } from '@surplus/audit';

import { prisma } from '../prisma/prisma.client';
import { StructuredLoggerService } from '../observability/structured-logger.service';

@Injectable()
export class AuditService {
  private readonly engine = new AuditEngine(prisma);

  constructor(private readonly logger: StructuredLoggerService) {}

  async logAction(params: {
    tenantId: string;
    action: string;
    actorId?: string | null;
    caseId?: string | null;
    caseRef?: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await this.engine.append({
        tenantId: params.tenantId,
        eventType: params.action,
        actor: params.actorId ?? null,
        payload: params.metadata ?? {},
        caseRef: params.caseRef,
        caseId: params.caseId ?? null
      });
    } catch (error) {
      this.logger.error('Failed to append to audit log', error as Error);
    }
  }

  async verifyChain(tenantId: string, range?: VerificationRange): Promise<VerificationResult> {
    return this.engine.verifyChain(tenantId, range);
  }

  async exportCaseAudit(tenantId: string, caseRef: string): Promise<string> {
    const records = await prisma.auditLog.findMany({
      where: { tenantId, caseRef },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    return records.map((record) => JSON.stringify(record)).join('\n');
  }
}
