import { z } from 'zod';

export const TOGO_COUNTRY_CODE = '228';

export type PhoneResult =
  { ok: true; e164: string; country: 'TG' | null } | { ok: false; reason: 'EMPTY' | 'INVALID' };

/**
 * Normalize a phone number to E.164.
 * - Togo (default region): "90 12 34 56", "+228 90123456", "00228 90123456", "228 90123456" -> "+22890123456".
 *   Exactly 8 national digits.
 * - Other countries: must start with "+" or "00" followed by 8-14 digits (E.164 max 15 total).
 */
export function normalizePhone(
  input: string,
  defaultCountryCode: string = TOGO_COUNTRY_CODE,
): PhoneResult {
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'EMPTY' };
  if (!/^[+\d\s().-]+$/.test(raw)) return { ok: false, reason: 'INVALID' };

  const hadPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  let international = hadPlus;
  if (!international && digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }

  if (!international) {
    if (defaultCountryCode === TOGO_COUNTRY_CODE) {
      if (digits.startsWith(TOGO_COUNTRY_CODE) && digits.length === 11) {
        digits = digits.slice(3);
      }
      return /^\d{8}$/.test(digits)
        ? { ok: true, e164: `+${TOGO_COUNTRY_CODE}${digits}`, country: 'TG' }
        : { ok: false, reason: 'INVALID' };
    }
    digits = defaultCountryCode + digits.replace(/^0+/, '');
  }

  if (digits.startsWith(TOGO_COUNTRY_CODE)) {
    return /^228\d{8}$/.test(digits)
      ? { ok: true, e164: `+${digits}`, country: 'TG' }
      : { ok: false, reason: 'INVALID' };
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return { ok: false, reason: 'INVALID' };
  return { ok: true, e164: `+${digits}`, country: null };
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input).ok;
}

/** Zod schema: accepts loose input, outputs E.164. */
export const phoneSchema = z.string().transform((value, ctx) => {
  const result = normalizePhone(value);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
    return z.NEVER;
  }
  return result.e164;
});

/** Display a Togo E.164 number as "+228 90 12 34 56"; other numbers are returned unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+228 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}
