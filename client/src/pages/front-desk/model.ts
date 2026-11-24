import { z } from 'zod';

import type { AvailableRoom, CheckoutBlocker, CheckoutPreview, Identity } from './api';

/** Pure rules of the front-desk screens (unit-tested without rendering). */

export const emptyIdentity = (): Identity => ({
  firstName: '',
  lastName: '',
  birthDate: '',
  birthPlace: '',
  nationality: '',
  profession: '',
  address: '',
  idDocType: '',
  idDocNumber: '',
  idIssuedOn: '',
  idIssuedPlace: '',
});

/** Guest profile as returned by `GET /guests/:id` (the document number is masked). */
export interface GuestProfile {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  profession: string | null;
  address: string | null;
  idDocType: string | null;
  idDocNumberMasked: string | null;
}

/** Prefills the police form from the guest profile (the server keeps the stored number). */
export function prefillIdentity(g: GuestProfile | undefined | null): Identity {
  if (!g) return emptyIdentity();
  return {
    guestId: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    birthDate: g.birthDate ?? '',
    birthPlace: g.birthPlace ?? '',
    nationality: g.nationality ?? '',
    profession: g.profession ?? '',
    address: g.address ?? '',
    idDocType: g.idDocType ?? '',
    idDocNumber: '',
    idIssuedOn: '',
    idIssuedPlace: '',
  };
}

const required = (key: string) => z.string().trim().min(1, key);

/** Mandatory fields of the police form (doc 09 §4); messages are i18n keys of `frontDesk`. */
export const identitySchema = z.object({
  lastName: required('validation.required'),
  firstName: required('validation.required'),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.required'),
  birthPlace: required('validation.required'),
  nationality: z.string().regex(/^[A-Z]{2}$/, 'validation.nationality'),
  address: required('validation.required'),
  idDocType: required('validation.required'),
  idDocNumber: z.string().trim().min(2, 'validation.idNumber'),
});

export type IdentityErrors = Partial<Record<keyof Identity, string>>;

/**
 * Validates one identity. `storedNumber`: the guest profile already holds an encrypted document
 * number (masked in the UI), so leaving the field empty keeps it.
 */
export function validateIdentity(id: Identity, opts: { storedNumber?: boolean } = {}): IdentityErrors {
  const out: IdentityErrors = {};
  const parsed = identitySchema.safeParse({
    ...id,
    idDocNumber: id.idDocNumber || (opts.storedNumber ? 'stored' : ''),
  });
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof Identity;
      out[key] ??= issue.message;
    }
  if (id.idIssuedOn && !/^\d{4}-\d{2}-\d{2}$/.test(id.idIssuedOn)) out.idIssuedOn = 'validation.date';
  return out;
}

export const hasErrors = (e: IdentityErrors) => Object.keys(e).length > 0;

/** Room options of the check-in step: clean rooms first (suggested), dirty ones flagged last. */
export function sortRooms(rooms: readonly AvailableRoom[], assignedId: string | null) {
  return [...rooms].sort(
    (a, b) =>
      Number(b.clean) - Number(a.clean) ||
      Number(b.id === assignedId) - Number(a.id === assignedId) ||
      a.number.localeCompare(b.number, undefined, { numeric: true }),
  );
}

/** Can this room be picked? Dirty rooms only with the override permission. */
export const roomSelectable = (r: AvailableRoom, canOverride: boolean) => r.clean || canOverride;

/** Server body `guests[]` entry: empty strings are omitted (prefilled server-side). */
export function toGuestBody(id: Identity) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(id)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  else if (k === 'guestId' && v) out[k] = v;
  return out;
}

export type CheckoutAction = 'checkout' | 'transfer' | 'override' | 'blocked';

/**
 * What the check-out button can do with the current preview: nothing blocks → `checkout`;
 * a balance can go to a company account (NIF required) or be forced with the dedicated
 * permission and a reason; otherwise the check-out stays `blocked` (settle first).
 */
export function checkoutAction(
  preview: Pick<CheckoutPreview, 'blockers' | 'balance'>,
  o: { companyId?: string | null; companyHasNif?: boolean; overrideReason?: string; canOverride: boolean },
): CheckoutAction {
  const blockers = preview.blockers.filter((b) => b.code !== 'NOT_IN_HOUSE');
  if (!blockers.length) return 'checkout';
  const onlyBalance = blockers.every((b) => b.code === 'UNPAID_BALANCE');
  if (onlyBalance && o.companyId && o.companyHasNif) return 'transfer';
  if (o.canOverride && (o.overrideReason?.trim().length ?? 0) >= 3) return 'override';
  return 'blocked';
}

export const blockerKey = (b: CheckoutBlocker) => `checkout.blocker.${b.code}`;

/** Server field error path `guests.0.birthDate` → [index, field]. */
export function parseGuestPath(path: string): [number, keyof Identity] | null {
  const m = /^guests\.(\d+)\.(\w+)$/.exec(path);
  return m ? [Number(m[1]), m[2] as keyof Identity] : null;
}
