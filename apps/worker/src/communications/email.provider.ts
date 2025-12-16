export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
};

export type EmailSendResult = {
  provider: string;
  messageId: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

class StubEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const messageId = `stub-${Date.now()}`;
    console.info('Stub email provider invoked', { to: message.to, subject: message.subject });
    return { provider: 'stub', messageId };
  }
}

class SendGridProvider implements EmailProvider {
  constructor(private apiKey: string | undefined) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.apiKey) {
      const fallback = new StubEmailProvider();
      return fallback.send(message);
    }

    // Real integration intentionally stubbed for this environment
    return { provider: 'sendgrid', messageId: `sg-${Date.now()}` };
  }
}

class MailgunProvider implements EmailProvider {
  constructor(private apiKey: string | undefined) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.apiKey) {
      const fallback = new StubEmailProvider();
      return fallback.send(message);
    }

    // Real integration intentionally stubbed for this environment
    return { provider: 'mailgun', messageId: `mg-${Date.now()}` };
  }
}

export function buildEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER?.toLowerCase() ?? 'stub';
  if (provider === 'sendgrid') {
    return new SendGridProvider(process.env.SENDGRID_API_KEY);
  }
  if (provider === 'mailgun') {
    return new MailgunProvider(process.env.MAILGUN_API_KEY);
  }
  return new StubEmailProvider();
}
