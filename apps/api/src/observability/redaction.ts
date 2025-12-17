const PII_KEYS = [
  'password',
  'token',
  'ssn',
  'social_security_number',
  'email',
  'phone',
  'address',
  'birthdate',
  'date_of_birth',
  'fullName'
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_REGEX = /\+?\d{1,3}?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

export function redactPII<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactPII(item)) as unknown as T;
  }

  if (typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.includes(key)) {
        redacted[key] = '[REDACTED]';
        continue;
      }

      redacted[key] = redactPII(val);
    }

    return redacted as T;
  }

  if (typeof value === 'string') {
    if (EMAIL_REGEX.test(value) || PHONE_REGEX.test(value)) {
      return '[REDACTED]' as T;
    }
  }

  return value;
}
