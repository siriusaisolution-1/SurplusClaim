import { CASE_REF_PATTERN } from '../caseRef';
import { UPL_DISCLAIMER } from '../upl';

type RiskLevel = 'LOW' | 'HIGH';

type VariableRule = {
  pattern?: RegExp;
  maxLength?: number;
  required?: boolean;
};

export type CommunicationChannel = 'EMAIL';

export type TemplateDefinition = {
  id: string;
  version: string;
  name: string;
  description: string;
  channel: CommunicationChannel;
  subject: string;
  body: string;
  riskLevel: RiskLevel;
  variables: Record<string, VariableRule>;
};

export type CommunicationPlan = {
  templateId: string;
  templateVersion: string;
  variables: Record<string, string>;
  sendAt: Date;
  channel: CommunicationChannel;
};

export type RenderedCommunication = {
  subject: string;
  body: string;
  templateId: string;
  templateVersion: string;
  disclaimer: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class TemplateRegistry {
  private readonly templatesById: Map<string, TemplateDefinition[]> = new Map();

  constructor(definitions: TemplateDefinition[]) {
    definitions.forEach((definition) => {
      const existing = this.templatesById.get(definition.id) ?? [];
      this.templatesById.set(definition.id, [...existing, definition]);
    });
  }

  list(): TemplateDefinition[] {
    return Array.from(this.templatesById.values())
      .map((versions) => versions.sort((a, b) => a.version.localeCompare(b.version)))
      .map((versions) => versions[versions.length - 1]);
  }

  get(templateId: string, version?: string): TemplateDefinition {
    const versions = this.templatesById.get(templateId);
    if (!versions || versions.length === 0) {
      throw new Error(`Template ${templateId} not found`);
    }

    if (version) {
      const match = versions.find((item) => item.version === version);
      if (!match) {
        throw new Error(`Template ${templateId} version ${version} not found`);
      }
      return match;
    }

    const sorted = versions.sort((a, b) => a.version.localeCompare(b.version));
    return sorted[sorted.length - 1];
  }

  validateVariables(template: TemplateDefinition, variables: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    Object.keys(variables).forEach((key) => {
      if (!template.variables[key]) {
        throw new Error(`Unexpected variable provided: ${key}`);
      }
    });

    Object.entries(template.variables).forEach(([key, rule]) => {
      const value = variables[key];
      if (rule.required && (!value || value.trim() === '')) {
        throw new Error(`Missing required variable: ${key}`);
      }

      if (value) {
        if (rule.maxLength && value.length > rule.maxLength) {
          throw new Error(`Variable ${key} exceeds maximum length of ${rule.maxLength}`);
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          throw new Error(`Variable ${key} failed validation`);
        }
        sanitized[key] = value;
      }
    });

    return sanitized;
  }

  render(templateId: string, variables: Record<string, string>, version?: string): RenderedCommunication {
    const template = this.get(templateId, version);
    const validated = this.validateVariables(template, variables);
    const subject = this.interpolate(template.subject, validated);

    if (!subject.includes('[') || !subject.includes(']')) {
      throw new Error('Subject must include case reference token');
    }

    const body = `${this.interpolate(template.body, validated)}\n\n---\n${UPL_DISCLAIMER}`;

    return {
      subject,
      body,
      templateId: template.id,
      templateVersion: template.version,
      disclaimer: UPL_DISCLAIMER
    };
  }

  planEmail(templateId: string, variables: Record<string, string>, sendAt?: Date, version?: string): CommunicationPlan {
    const template = this.get(templateId, version);
    const validated = this.validateVariables(template, variables);
    return {
      templateId: template.id,
      templateVersion: template.version,
      variables: validated,
      channel: template.channel,
      sendAt: sendAt ?? new Date()
    };
  }

  private interpolate(text: string, variables: Record<string, string>): string {
    return text.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => variables[key] ?? '');
  }
}

export const templateRegistry = new TemplateRegistry([
  {
    id: 'discovery_notice',
    version: 'v1',
    name: 'Discovery notice',
    description: 'Informational email to alert parties to a located surplus claim.',
    channel: 'EMAIL',
    riskLevel: 'LOW',
    subject: '[{{case_ref}}] Surplus funds discovery notice',
    body: [
      'Hello {{recipient_name}},',
      'We identified a potential surplus claim associated with case {{case_ref}}.',
      'This notice is informational only and does not require immediate action. If you believe this was sent in error, let us know at {{reply_to}}.'
    ].join(' '),
    variables: {
      recipient_name: { pattern: /^[A-Za-z .'-]{2,80}$/, required: true },
      recipient_email: { pattern: EMAIL_PATTERN, required: true },
      reply_to: { pattern: EMAIL_PATTERN, required: true },
      case_ref: { pattern: CASE_REF_PATTERN, required: true }
    }
  },
  {
    id: 'consent_request',
    version: 'v1',
    name: 'Consent request',
    description: 'Request consent signature for claim handling.',
    channel: 'EMAIL',
    riskLevel: 'LOW',
    subject: '[{{case_ref}}] Action requested: consent needed',
    body: [
      'Hello {{recipient_name}},',
      'To proceed with the surplus claim on case {{case_ref}}, please review and sign the consent materials.',
      'You can review the packet here: {{consent_link}}. If you have questions, reply to {{reply_to}}.'
    ].join(' '),
    variables: {
      recipient_name: { pattern: /^[A-Za-z .'-]{2,80}$/, required: true },
      recipient_email: { pattern: EMAIL_PATTERN, required: true },
      reply_to: { pattern: EMAIL_PATTERN, required: true },
      consent_link: { maxLength: 2048, pattern: /^https?:\/\//i, required: true },
      case_ref: { pattern: CASE_REF_PATTERN, required: true }
    }
  },
  {
    id: 'consent_reminder',
    version: 'v1',
    name: 'Consent reminder',
    description: 'Reminder to review and sign consent documents.',
    channel: 'EMAIL',
    riskLevel: 'LOW',
    subject: '[{{case_ref}}] Reminder: consent still pending',
    body: [
      'Hello {{recipient_name}},',
      'We are following up on the consent request for case {{case_ref}}.',
      'Please use {{consent_link}} to review the documents. If you need more time, respond to {{reply_to}}.'
    ].join(' '),
    variables: {
      recipient_name: { pattern: /^[A-Za-z .'-]{2,80}$/, required: true },
      recipient_email: { pattern: EMAIL_PATTERN, required: true },
      reply_to: { pattern: EMAIL_PATTERN, required: true },
      consent_link: { maxLength: 2048, pattern: /^https?:\/\//i, required: true },
      case_ref: { pattern: CASE_REF_PATTERN, required: true }
    }
  },
  {
    id: 'missing_docs',
    version: 'v1',
    name: 'Missing documents reminder',
    description: 'Reminder that documents are needed to complete the claim.',
    channel: 'EMAIL',
    riskLevel: 'HIGH',
    subject: '[{{case_ref}}] Documents requested for claim processing',
    body: [
      'Hello {{recipient_name}},',
      'We still need the following items to move forward with case {{case_ref}}: {{missing_items}}.',
      'Please send these to {{reply_to}} or upload using the provided instructions.'
    ].join(' '),
    variables: {
      recipient_name: { pattern: /^[A-Za-z .'-]{2,80}$/, required: true },
      recipient_email: { pattern: EMAIL_PATTERN, required: true },
      reply_to: { pattern: EMAIL_PATTERN, required: true },
      missing_items: { maxLength: 500, required: true },
      case_ref: { pattern: CASE_REF_PATTERN, required: true }
    }
  },
  {
    id: 'status_update',
    version: 'v1',
    name: 'Neutral status update',
    description: 'Provide a neutral update on current processing.',
    channel: 'EMAIL',
    riskLevel: 'LOW',
    subject: '[{{case_ref}}] Status update on your surplus claim',
    body: [
      'Hello {{recipient_name}},',
      'This is an update on case {{case_ref}}: {{status_note}}.',
      'We will continue to keep you informed. Direct replies can be sent to {{reply_to}}.'
    ].join(' '),
    variables: {
      recipient_name: { pattern: /^[A-Za-z .'-]{2,80}$/, required: true },
      recipient_email: { pattern: EMAIL_PATTERN, required: true },
      reply_to: { pattern: EMAIL_PATTERN, required: true },
      status_note: { maxLength: 400, required: true },
      case_ref: { pattern: CASE_REF_PATTERN, required: true }
    }
  },
  {
    id: 'deadline_reminder',
    version: 'v1',
    name: 'Procedural deadline reminder',
    description: 'Notify internal owners about an upcoming procedural deadline.',
    channel: 'EMAIL',
    riskLevel: 'LOW',
    subject: '[{{case_ref}}] Deadline approaching: {{deadline_name}}',
    body: [
      'Hello {{recipient_name}},',
      'This is a reminder that the procedural item {{deadline_name}} is due by {{due_date}} for case {{case_ref}}.',
      'If this has already been handled, no further action is needed. For questions, reply to {{reply_to}}.'
    ].join(' '),
    variables: {
      recipient_name: { pattern: /^[A-Za-z .'-]{2,80}$/, required: true },
      recipient_email: { pattern: EMAIL_PATTERN, required: true },
      reply_to: { pattern: EMAIL_PATTERN, required: true },
      deadline_name: { maxLength: 120, required: true },
      due_date: { maxLength: 120, required: true },
      case_ref: { pattern: CASE_REF_PATTERN, required: true }
    }
  }
]);

export { UPL_DISCLAIMER as DISCLAIMER };
