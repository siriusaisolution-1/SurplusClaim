import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPasswordForStorage(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(':');
  const hashed = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hashed, 'hex'));
}

export function hashToken(token: string) {
  const salt = token.slice(0, 16);
  const derivedKey = scryptSync(token, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}
