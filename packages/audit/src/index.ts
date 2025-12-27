import { createHash } from 'node:crypto';

import { AuditLog, Prisma, PrismaClient } from '@prisma/client';

function canonicalize(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item)) as Prisma.InputJsonValue[];
  }
  if (typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const canonicalObject = sortedKeys.reduce<Record<string, Prisma.InputJsonValue | Prisma.NullTypes.DbNull>>((acc, key) => {
      acc[key] = canonicalize((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
    return canonicalObject as unknown as Prisma.InputJsonValue;
  }
  return Prisma.DbNull;
}

function canonicalJson(payload: unknown): string {
  const normalized = canonicalize(payload);
  return JSON.stringify(normalized === Prisma.DbNull ? null : normalized);
}

function computeHash(params: {
  prevHash: string;
  payload: unknown;
  timestamp: string;
  actor: string;
  eventType: string;
}): string {
  return createHash('sha256')
    .update(`${params.prevHash}${canonicalJson(params.payload)}${params.timestamp}${params.actor}${params.eventType}`)
    .digest('hex');
}

export interface VerificationRange {
  caseRef?: string;
  from?: Date;
  to?: Date;
}

export interface VerificationResult {
  isValid: boolean;
  checked: number;
  brokenRecord?: {
    record: AuditLog;
    expectedHash: string;
    expectedPrevHash: string;
    index: number;
  };
}

export class AuditEngine {
  constructor(private prisma: PrismaClient) {}

  async append(params: {
    tenantId: string;
    eventType: string;
    actor?: string | null;
    payload?: Record<string, unknown>;
    caseRef?: string;
    caseId?: string | null;
  }): Promise<AuditLog> {
    const prev = await this.prisma.auditLog.findFirst({
      where: { tenantId: params.tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    const createdAt = new Date();
    const prevHash = prev?.hash ?? '';
    const actor = params.actor ?? '';
    const payload = (params.payload ?? {}) as Prisma.InputJsonValue;
    const hash = computeHash({
      prevHash,
      payload,
      timestamp: createdAt.toISOString(),
      actor,
      eventType: params.eventType
    });

    return this.prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        caseId: params.caseId ?? null,
        caseRef: params.caseRef ?? 'GENERAL',
        actorId: params.actor ?? null,
        action: params.eventType,
        metadata: payload,
        hash,
        prevHash: prev?.hash ?? null,
        createdAt
      }
    });
  }

  async verifyChain(tenantId: string, range?: VerificationRange): Promise<VerificationResult> {
    const records = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        ...(range?.caseRef ? { caseRef: range.caseRef } : {}),
        ...(range?.from || range?.to
          ? {
              createdAt: {
                ...(range?.from ? { gte: range.from } : {}),
                ...(range?.to ? { lte: range.to } : {})
              }
            }
          : {})
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    let expectedPrevHash = '';

    for (const [index, record] of records.entries()) {
      const expectedHash = computeHash({
        prevHash: expectedPrevHash,
        payload: record.metadata,
        timestamp: record.createdAt.toISOString(),
        actor: record.actorId ?? '',
        eventType: record.action
      });

      if (record.prevHash !== (expectedPrevHash || null) || record.hash !== expectedHash) {
        return {
          isValid: false,
          checked: records.length,
          brokenRecord: { record, expectedHash, expectedPrevHash, index }
        };
      }

      expectedPrevHash = record.hash;
    }

    return { isValid: true, checked: records.length };
  }
}

export const canonical = canonicalJson;
