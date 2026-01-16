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
const MAX_DEPTH = 10;
const PII_KEYS_SET = new Set(PII_KEYS.map((key) => key.toLowerCase()));

export function redactPII<T>(value: T): T {
  return redactValue(value, 0, new WeakSet());
}

function redactValue<T>(value: T, depth: number, visited: WeakSet<object>): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > MAX_DEPTH) {
    return value;
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return '[CIRCULAR]' as T;
    }
    visited.add(value);
    return value.map((item) => redactValue(item, depth + 1, visited)) as unknown as T;
  }

  if (typeof value === 'object') {
    if (visited.has(value)) {
      return '[CIRCULAR]' as T;
    }
    visited.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS_SET.has(key.toLowerCase())) {
        redacted[key] = '[REDACTED]';
        continue;
      }

      redacted[key] = redactValue(val, depth + 1, visited);
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
