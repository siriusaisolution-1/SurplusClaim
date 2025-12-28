/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
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

export enum CommunicationDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND'
}

export enum CommunicationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS'
}

export class PrismaClient {
  communication: any;
  caseEvent: any;
  case: any;

  constructor(..._args: any[]) {}
}
