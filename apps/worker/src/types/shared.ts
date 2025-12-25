/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
export type NormalizedCase = Record<string, unknown>;
export const NormalizedCaseSchema: unknown = {};
export function generateCaseRef(..._args: any[]): string {
  return '';
}

export const templateRegistry: {
  render: (templateId: string, variables: Record<string, unknown>) => {
    templateId: string;
    templateVersion?: string;
    subject: string;
    body: string;
  };
} = {
  render: (_templateId, _variables) => ({
    templateId: '',
    templateVersion: undefined,
    subject: '',
    body: ''
  })
};

export const DISCLAIMER: unknown = undefined;

export interface AuditEvent {
  event: string;
  occurred_at: string | Date;
  actor: { type: 'system' | 'user' | 'service'; id: string; email?: string };
  target?: { type: string; id: string };
  request_id?: string;
  context?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export interface CanonicalAuditEvent extends AuditEvent {
}
