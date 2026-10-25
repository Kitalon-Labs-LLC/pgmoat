import { refuse, type PgmoatError } from '../errors.js';

/**
 * Calculates the UTF-8 byte length of a value when serialized to JSON.
 */
export function measurePayloadBytes(val: unknown): number {
  const json = JSON.stringify(val);
  return Buffer.byteLength(json, 'utf-8');
}

/**
 * Checks whether the serialized payload exceeds maxPayloadBytes.
 * Returns a PGM-305 refusal error if exceeded, or null if within budget.
 */
export function checkPayloadBudget(
  candidate: unknown,
  maxPayloadBytes: number,
): { bytes: number; error: PgmoatError | null } {
  const bytes = measurePayloadBytes(candidate);
  if (bytes > maxPayloadBytes) {
    const err = refuse(
      'PGM-305',
      `Result payload (${bytes} bytes) exceeds maximum allowed payload of ${maxPayloadBytes} bytes.`,
      'Select fewer columns or rows',
    );
    return { bytes, error: err };
  }
  return { bytes, error: null };
}

