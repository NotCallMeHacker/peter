const SECRET = 'this-is-a-highly-secure-key-that-doesnt-really-need-to-be-secret';
const ROUNDS = 6;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** SplitMix32 hash – returns an unsigned 32-bit integer. */
function splitmix32(x: number): number {
  x = (x + 0x9e3779b9) | 0;
  let z = x;
  z = (z ^ (z >>> 16)) >>> 0;
  z = Math.imul(z, 0x21f0aaad) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  z = Math.imul(z, 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z >>> 0;
}

/** FNV-1a string hash – returns an unsigned 32-bit integer. */
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Generate a pseudo-random digit sequence keyed by (secret, round, input). */
function generateKeystream(
  round: number,
  input: string,
  length: number
): number[] {
  let seed = hashString(SECRET + ':' + round + ':' + input);
  const digits: number[] = [];
  for (let i = 0; i < length; i++) {
    seed = splitmix32(seed);
    digits.push(seed % 10);
  }
  return digits;
}

function digitsFromString(s: string): number[] {
  return Array.from(s, (ch) => ch.charCodeAt(0) - 48);
}

function digitsToString(d: number[]): string {
  return d.map((x) => String(x)).join('');
}

function addDigits(a: number[], b: number[]): number[] {
  return a.map((v, i) => (v + b[i]) % 10);
}

function subDigits(a: number[], b: number[]): number[] {
  return a.map((v, i) => (v - b[i] + 10) % 10);
}

/* ------------------------------------------------------------------ */
/* Feistel core                                                       */
/* ------------------------------------------------------------------ */

function feistelEncrypt(digits: number[]): number[] {
  const n = digits.length;
  if (n === 0) return [];

  const split = Math.ceil(n / 2);
  let L = digits.slice(0, split);
  let R = digits.slice(split);

  for (let round = 0; round < ROUNDS; round++) {
    const ks = generateKeystream(round, digitsToString(R), L.length);
    const newR = addDigits(L, ks);
    L = R;
    R = newR;
  }

  return [...L, ...R];
}

function feistelDecrypt(digits: number[]): number[] {
  const n = digits.length;
  if (n === 0) return [];

  const split = Math.ceil(n / 2);
  let L = digits.slice(0, split);
  let R = digits.slice(split);

  for (let round = ROUNDS - 1; round >= 0; round--) {
    const ks = generateKeystream(round, digitsToString(L), R.length);
    const newL = subDigits(R, ks);
    R = L;
    L = newL;
  }

  return [...L, ...R];
}

/* ------------------------------------------------------------------ */
/* Input normalisation                                                */
/* ------------------------------------------------------------------ */

function normalizeInput(value: number | string): string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('Numeric ID must be a non-negative integer.');
    }
    if (value > Number.MAX_SAFE_INTEGER) {
      throw new Error(
        `Numeric ID exceeds MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}). Pass it as a string.`
      );
    }
    return String(value).padStart(6, '0');
  }

  const str = String(value).trim();
  if (!/^\d+$/.test(str)) {
    throw new Error('ID must be a non-empty string of digits (0–9).');
  }
  return str.length < 6 ? str.padStart(6, '0') : str;
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Obfuscate an internal ID into a digit string.
 *
 * - IDs shorter than 6 digits are padded to 6 digits; the result is 6 digits.
 * - IDs with 6+ digits keep their exact length.
 *
 * @param id The internal ID (number or string of digits).
 * @returns  An obfuscated digit string.
 */
export function toPublic(id: number | string): string {
  const raw = normalizeInput(id);
  const cipher = feistelEncrypt(digitsFromString(raw));
  return digitsToString(cipher);
}

/**
 * Recover the original internal ID from an obfuscated digit string.
 *
 * @param id The obfuscated ID (number or string of digits).
 * @returns  The original digit string, preserving any leading zeros.
 */
export function toInternal(id: number | string): string {
  const raw = normalizeInput(id);
  const plain = feistelDecrypt(digitsFromString(raw));
  return digitsToString(plain);
}
