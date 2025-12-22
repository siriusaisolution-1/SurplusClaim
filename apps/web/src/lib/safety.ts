import { AI_OUTPUT_RULES, UPL_DISCLAIMER } from './upl';

export function guardSuggestionResponse<T extends { rationale: string[]; disclaimer?: string }>(
  payload: T | null
): (T & { disclaimer: string }) | null {
  if (!payload) return null;
  if (payload.disclaimer !== UPL_DISCLAIMER) return null;
  const invalid = payload.rationale.some((item) => !AI_OUTPUT_RULES.rationaleMessages.has(item));
  if (invalid) return null;
  return { ...payload, disclaimer: payload.disclaimer } as T & { disclaimer: string };
}

export function formatSafeLabel(label?: string | null) {
  if (!label) return 'Unlabeled';
  const trimmed = label.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return 'Hidden (unvalidated label)';
  return trimmed;
}

export function sanitizeDocType(label?: string | null) {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return undefined;
  return trimmed;
}
