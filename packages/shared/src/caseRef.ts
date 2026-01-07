import crypto from 'crypto';

export interface CaseRefParts {
  state: string;
  countyCode: string;
  date: string;
  random: string;
  checkDigit: string;
}

const RAND_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CHECKSUM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CASE_REF_REGEX = /^TS-([A-Z]{2})-([A-Z0-9]{3,8})-(\d{8})-([A-Z0-9]{6})-([A-Z0-9])$/;
const CASE_REF_SEARCH_REGEX = /TS-[A-Z]{2}-[A-Z0-9]{3,8}-\d{8}-[A-Z0-9]{6}-[A-Z0-9]/gi;
const COUNTER_BASE = 36;
const COUNTER_WIDTH = 2;
const COUNTER_MODULO = COUNTER_BASE ** COUNTER_WIDTH;

function toYyyyMmDd(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date provided');
  }

  const year = d.getUTCFullYear();
  const month = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${year}${month}${day}`;
}

function randomBlock(length: number): string {
  const bytes = crypto.randomBytes(length);
  let output = '';

  for (let i = 0; i < length; i += 1) {
    const index = bytes[i] % RAND_ALPHABET.length;
    output += RAND_ALPHABET[index];
  }

  return output;
}

let lastTimestamp = 0;
let counter = 0;

function uniqueRandomBlock(): string {
  const timestamp = Date.now();
  if (timestamp === lastTimestamp) {
    counter = (counter + 1) % COUNTER_MODULO;
  } else {
    lastTimestamp = timestamp;
    counter = 0;
  }

  const counterSuffix = counter.toString(COUNTER_BASE).toUpperCase().padStart(COUNTER_WIDTH, '0');
  return `${randomBlock(4)}${counterSuffix}`;
}

function charToValue(char: string): number {
  if (/^[0-9]$/.test(char)) {
    return Number.parseInt(char, 10);
  }

  if (/^[A-Z]$/.test(char)) {
    return char.charCodeAt(0) - 55; // A => 10
  }

  return 0;
}

function computeCheckDigit(core: string): string {
  const cleaned = core.replace(/-/g, '').toUpperCase();
  let accumulator = 0;

  for (let i = 0; i < cleaned.length; i += 1) {
    const value = charToValue(cleaned[i]);
    accumulator = (accumulator * 31 + value) % CHECKSUM_ALPHABET.length;
  }

  return CHECKSUM_ALPHABET[accumulator];
}

export function generateCaseRef(params: {
  state: string;
  countycode: string;
  date: string | Date;
}): string {
  const state = params.state.toUpperCase();
  const countycode = params.countycode.toUpperCase();
  const date = toYyyyMmDd(params.date);
  const random = uniqueRandomBlock();
  const base = `TS-${state}-${countycode}-${date}-${random}`;
  const checkDigit = computeCheckDigit(base);

  return `${base}-${checkDigit}`;
}

export function validateCaseRef(caseRef: string): boolean {
  const match = CASE_REF_REGEX.exec(caseRef);
  if (!match) {
    return false;
  }

  const base = caseRef.slice(0, -2);
  const expectedCheckDigit = computeCheckDigit(base);
  const providedCheckDigit = match[5].toUpperCase();

  return expectedCheckDigit === providedCheckDigit;
}

export function parseCaseRef(caseRef: string): CaseRefParts {
  const match = CASE_REF_REGEX.exec(caseRef);

  if (!match) {
    throw new Error('Case reference is not in the expected format');
  }

  const base = caseRef.slice(0, -2);
  const expectedCheckDigit = computeCheckDigit(base);
  const providedCheckDigit = match[5].toUpperCase();

  if (expectedCheckDigit !== providedCheckDigit) {
    throw new Error('Invalid check digit');
  }

  return {
    state: match[1],
    countyCode: match[2],
    date: match[3],
    random: match[4],
    checkDigit: providedCheckDigit,
  };
}

export function extractCaseRefFromText(text: string): string | null {
  const matches = text.match(CASE_REF_SEARCH_REGEX);

  if (!matches) {
    return null;
  }

  for (const candidate of matches) {
    const canonical = candidate.toUpperCase();
    if (validateCaseRef(canonical)) {
      return canonical;
    }
  }

  return null;
}

export const CASE_REF_PATTERN = CASE_REF_REGEX;
