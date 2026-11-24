import type { Guest, Prisma, TransactionClient } from '@hm/database';
import { AppError } from '../../lib/errors.js';
import { validateCustomFields } from '../custom-fields/validation.js';
import { decryptIdNumber, encryptIdNumber, maskIdNumber } from '../guests/crypto.js';
import { formatDay, parseDay } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import type { PoliceGuestInput } from './schemas.js';
import { primaryGuestId, type StayRoom } from './common.js';

type Tx = TransactionClient;

/** Fields the police form cannot be saved without (doc 09 §4: required set to be confirmed). */
export const REQUIRED_IDENTITY = [
  'firstName',
  'lastName',
  'birthDate',
  'birthPlace',
  'nationality',
  'address',
  'idDocType',
  'idDocNumber',
] as const;

export interface Identity {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  profession: string | null;
  address: string | null;
  idDocType: string | null;
  /** Plain text, only in memory: never logged nor returned. */
  idDocNumber: string | null;
  idIssuedOn: string | null;
  idIssuedPlace: string | null;
}

export interface ResolvedGuest {
  guest: Guest | null;
  input: PoliceGuestInput;
  identity: Identity;
}

const secretOf = (ctx: RCtx) => ctx.services.config.JWT_ACCESS_SECRET;

export interface PoliceSnapshot {
  version: 1;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  profession: string | null;
  address: string | null;
  idDocType: string | null;
  /** AES-256-GCM (`guests/crypto`), never the plain number. */
  idDocNumberEnc: string | null;
  idIssuedOn: string | null;
  idIssuedPlace: string | null;
  provenance: string | null;
  destination: string | null;
  purpose: string | null;
  arrival: string;
  departure: string;
  businessDate: string;
  roomNumber: string | null;
  reservationNumber: string;
  primary: boolean;
  customFields: Record<string, unknown>;
}

const str = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/**
 * Merges the identity entered at the desk with the guest profile (prefill) and the last police
 * record of the guest (document issue date / place), then checks the mandatory fields.
 */
export async function resolveGuests(
  ctx: RCtx,
  db: Pick<Tx, 'guest' | 'policeRecord'>,
  rr: Pick<StayRoom, 'reservationGuests' | 'reservation'>,
  inputs: readonly PoliceGuestInput[],
  prefix = 'guests',
): Promise<ResolvedGuest[]> {
  const out: ResolvedGuest[] = [];
  const errors: { path: string; message: string; code: string }[] = [];
  const seen = new Set<string>();
  for (const [i, input] of inputs.entries()) {
    const guestId = input.guestId ?? (i === 0 ? primaryGuestId(rr as StayRoom) : null);
    let guest: Guest | null = null;
    if (guestId) {
      guest = await db.guest.findFirst({ where: { id: guestId, deletedAt: null } });
      if (!guest) {
        errors.push({ path: `${prefix}.${i}.guestId`, message: 'Unknown guest', code: 'not_found' });
        continue;
      }
      if (seen.has(guest.id)) {
        errors.push({
          path: `${prefix}.${i}.guestId`,
          message: 'The same guest is listed twice',
          code: 'duplicate',
        });
        continue;
      }
      seen.add(guest.id);
    }
    const last = guest
      ? await db.policeRecord.findFirst({
          where: { guestId: guest.id },
          orderBy: { createdAt: 'desc' },
          select: { snapshot: true },
        })
      : null;
    const prev = (last?.snapshot ?? {}) as Partial<PoliceSnapshot>;
    let profileNumber: string | null = null;
    if (guest?.idDocNumberEnc) {
      try {
        profileNumber = decryptIdNumber(guest.idDocNumberEnc, secretOf(ctx));
      } catch {
        profileNumber = null;
      }
    }
    const identity: Identity = {
      firstName: str(input.firstName) ?? guest?.firstName ?? '',
      lastName: str(input.lastName) ?? guest?.lastName ?? '',
      birthDate: input.birthDate ?? (guest?.birthDate ? formatDay(guest.birthDate) : null),
      birthPlace: str(input.birthPlace) ?? guest?.birthPlace ?? null,
      nationality: input.nationality ?? guest?.nationality ?? null,
      profession: str(input.profession) ?? guest?.profession ?? null,
      address: str(input.address) ?? guest?.address ?? null,
      idDocType: str(input.idDocType) ?? guest?.idDocType ?? null,
      idDocNumber: str(input.idDocNumber) ?? profileNumber,
      idIssuedOn: input.idIssuedOn ?? prev.idIssuedOn ?? null,
      idIssuedPlace: str(input.idIssuedPlace) ?? prev.idIssuedPlace ?? null,
    };
    for (const f of REQUIRED_IDENTITY)
      if (!identity[f])
        errors.push({
          path: `${prefix}.${i}.${f}`,
          message: 'Required for the police form',
          code: 'required',
        });
    out.push({ guest, input, identity });
  }
  if (errors.length) throw new AppError('VALIDATION_ERROR', undefined, { errors });
  return out;
}

/** Tenant custom fields of the police form (entity `police_record`). */
export const validatePoliceCustomFields = (ctx: RCtx, values: unknown) =>
  validateCustomFields(ctx.db, 'police_record', values ?? {}, { path: 'police.customFields' });

export function buildSnapshot(
  ctx: RCtx,
  r: ResolvedGuest,
  stay: {
    provenance?: string | null | undefined;
    destination?: string | null | undefined;
    purpose?: string | null | undefined;
  },
  facts: {
    arrival: string;
    departure: string;
    businessDate: string;
    roomNumber: string | null;
    reservationNumber: string;
    primary: boolean;
    customFields: Record<string, unknown>;
  },
): PoliceSnapshot {
  const id = r.identity;
  return {
    version: 1,
    firstName: id.firstName,
    lastName: id.lastName,
    birthDate: id.birthDate,
    birthPlace: id.birthPlace,
    nationality: id.nationality,
    profession: id.profession,
    address: id.address,
    idDocType: id.idDocType,
    idDocNumberEnc: id.idDocNumber ? encryptIdNumber(id.idDocNumber, secretOf(ctx)) : null,
    idIssuedOn: id.idIssuedOn,
    idIssuedPlace: id.idIssuedPlace,
    provenance: str(stay.provenance),
    destination: str(stay.destination),
    purpose: str(stay.purpose),
    arrival: facts.arrival,
    departure: facts.departure,
    businessDate: facts.businessDate,
    roomNumber: facts.roomNumber,
    reservationNumber: facts.reservationNumber,
    primary: facts.primary,
    customFields: facts.customFields,
  };
}

/** Writes the guest profile (create or update) from the identity entered at the desk. */
export async function saveGuestProfile(
  ctx: RCtx,
  tx: Tx,
  r: ResolvedGuest,
  extra: { idDocFileId?: string | undefined },
): Promise<Guest> {
  const id = r.identity;
  const data = {
    firstName: id.firstName,
    lastName: id.lastName,
    birthDate: id.birthDate ? parseDay(id.birthDate) : null,
    birthPlace: id.birthPlace,
    nationality: id.nationality,
    profession: id.profession,
    address: id.address,
    idDocType: id.idDocType,
    idDocNumberEnc: id.idDocNumber ? encryptIdNumber(id.idDocNumber, secretOf(ctx)) : null,
    ...(extra.idDocFileId ? { idDocFileId: extra.idDocFileId } : {}),
  } satisfies Prisma.GuestUncheckedUpdateInput;
  if (!r.guest)
    return tx.guest.create({
      data: { ...data, tenantId: ctx.tenantId, tags: [], createdBy: ctx.actorId },
    });
  if (!r.input.updateProfile && !extra.idDocFileId) return r.guest;
  if (!r.input.updateProfile) {
    return tx.guest.update({
      where: { id: r.guest.id },
      data: { idDocFileId: extra.idDocFileId ?? null },
    });
  }
  return tx.guest.update({ where: { id: r.guest.id }, data });
}

// ───────────────────────────── masking (register) ─────────────────────────────

/**
 * Sensitive fields of the police register: document number (last 4 characters only), birth date
 * (year only), birth place, address and document issue place. Unmasked only with `guests.export`.
 */
export function readIdNumber(ctx: RCtx, enc: string | null, unmasked: boolean): string | null {
  if (!enc) return null;
  try {
    const plain = decryptIdNumber(enc, secretOf(ctx));
    return unmasked ? plain : maskIdNumber(plain);
  } catch {
    return '••••';
  }
}

export const maskBirthDate = (d: string | null): string | null => (d ? `${d.slice(0, 4)}-••-••` : null);
