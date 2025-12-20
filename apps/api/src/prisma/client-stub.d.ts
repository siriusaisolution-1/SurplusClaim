declare module '@prisma/client' {
  export enum CaseStatus {
    DISCOVERED = 'DISCOVERED',
    TRIAGED = 'TRIAGED',
    CLIENT_CONTACTED = 'CLIENT_CONTACTED',
    CONSENT_SIGNED = 'CONSENT_SIGNED',
    DOCUMENT_COLLECTION = 'DOCUMENT_COLLECTION',
    PACKAGE_READY = 'PACKAGE_READY',
    SUBMITTED = 'SUBMITTED',
    PAYOUT_CONFIRMED = 'PAYOUT_CONFIRMED',
    CLOSED = 'CLOSED',
    ESCALATED = 'ESCALATED',
    ON_HOLD = 'ON_HOLD'
  }

  export enum TierLevel {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    ENTERPRISE = 'ENTERPRISE'
  }

  export enum CommunicationDirection {
    INBOUND = 'INBOUND',
    OUTBOUND = 'OUTBOUND'
  }

  export enum CommunicationChannel {
    EMAIL = 'EMAIL',
    SMS = 'SMS'
  }

  export enum DocumentStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
  }

  export type FeeAgreement = { [key: string]: any };
  export type AuditLog = unknown;

  export namespace Prisma {
    export type TransactionClient = any;
  }

  export class PrismaClient {
    constructor(...args: any[]);
    [key: string]: any;
  }
}
