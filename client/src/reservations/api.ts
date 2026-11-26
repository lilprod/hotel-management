import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@hm/ui';

import { apiClient } from '../auth/session';

/** Staff reservation API (`/api/v1/t`): types mirror the server Zod schemas (L6a). */

export const RESERVATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface NightPrice {
  date: string;
  base: number;
  extraAdultAmount: number;
  extraChildAmount: number;
  total: number;
}

export interface ReservationRoom {
  id: string;
  roomTypeId: string;
  roomId: string | null;
  roomNumber: string | null;
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  status: ReservationStatus;
  currency: string;
  dailyPrices: NightPrice[];
  total: number;
  guests: { guestId: string; isPrimary: boolean }[];
}

export interface Penalty {
  kind: 'CANCELLATION' | 'NO_SHOW';
  amount: number;
  computedAmount: number;
  waived: boolean;
  currency: string;
  businessDate: string;
  lines: {
    reservationRoomId: string;
    percent: number;
    amount: number;
    daysBefore: number;
    tier: number | null;
  }[];
}

export interface Booker {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  isBlacklisted: boolean;
}

export interface Reservation {
  id: string;
  propertyId: string;
  number: string;
  status: ReservationStatus;
  channel: string;
  source: string | null;
  segment: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  notes: string | null;
  optionExpiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  groupId: string | null;
  companyId: string | null;
  isAllotment: boolean;
  booker: Booker | null;
  currency: string;
  roomTotal: number;
  penalty: Penalty | null;
  customFields: Record<string, unknown>;
  rooms: ReservationRoom[];
  createdAt: string;
  updatedAt: string;
}

export interface Warning {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}
export interface ReservationResult {
  reservation: Reservation;
  warnings: Warning[];
}

export interface PlanningRoom {
  id: string;
  number: string;
  floor: string | null;
  building: string | null;
  hkStatus: string;
}
export interface PlanningSegment {
  id: string;
  reservationId: string;
  number: string;
  roomId: string | null;
  roomTypeId: string;
  guestName: string;
  status: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  groupId: string | null;
  kind: 'reservation' | 'group' | 'allotment';
  colorKey: string;
}
export interface PlanningBlock {
  id: string;
  roomId: string;
  fromDate: string;
  toDate: string;
  reason: string;
  note: string | null;
}
export interface PlanningData {
  propertyId: string;
  from: string;
  to: string;
  businessDate: string;
  roomTypes: {
    id: string;
    code: string;
    name: string;
    nameI18n?: Record<string, string>;
    rooms: PlanningRoom[];
    freeByNight: { date: string; free: number }[];
  }[];
  segments: PlanningSegment[];
  blocks: PlanningBlock[];
}

export interface RatePlanAvailability {
  ratePlanId: string;
  code: string;
  name: string;
  mealPlan: string;
  isPublic: boolean;
  available: boolean;
  reason: string | null;
  message: string | null;
  quote: { currency: string; nights: number; roomTotal: number; total: number } | null;
}
export interface AvailabilityRoomType {
  roomTypeId: string;
  code: string;
  name: string;
  nameI18n?: Record<string, string>;
  maxAdults: number;
  maxChildren: number;
  totalUnits: number;
  fitsOccupancy: boolean;
  freeByNight: { date: string; free: number }[];
  minFree: number;
  sellable: boolean;
  ratePlans: RatePlanAvailability[];
}
export interface Availability {
  propertyId: string;
  arrival: string;
  departure: string;
  nights: number;
  roomTypes: AvailabilityRoomType[];
}

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  isBlacklisted: boolean;
  nationality?: string | null;
}

export interface WaitlistEntry {
  id: string;
  propertyId: string;
  guestId: string;
  guestName: string;
  roomTypeId: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  status: 'WAITING' | 'OFFERED' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
  priority: number;
  offeredAt: string | null;
  offerExpiresAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Group {
  id: string;
  propertyId: string;
  name: string;
  companyId: string | null;
  allotmentReservationId: string | null;
  releaseDate: string | null;
  arrival: string | null;
  departure: string | null;
  block: { roomTypeId: string; rooms: number; held: number; pickedUp: number }[];
  roomingList: {
    reservationId: string;
    reservationRoomId: string;
    number: string;
    status: string;
    guestName: string;
    roomTypeId: string;
    roomId: string | null;
    roomNumber: string | null;
    arrival: string;
    departure: string;
  }[];
}

export interface LookupValue {
  id: string;
  code: string;
  label: { fr: string; en?: string };
  active: boolean;
}
export interface CustomFieldDef {
  id: string;
  key: string;
  label: { fr: string; en?: string };
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT' | 'MULTI_SELECT';
  options: { value: string; label: { fr: string; en?: string } }[] | null;
  required: boolean;
}
export interface RatePlan {
  id: string;
  code: string;
  name: string;
  mealPlan: string;
  isActive: boolean;
}
export interface AuditEntry {
  id: string;
  at: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
}

export const qs = (
  params: Record<string, string | number | boolean | undefined | null>,
): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const get = <T>(path: string) => apiClient.get<T>(path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
  apiClient.post<T>(path, body, headers ? { headers } : undefined);
export const patch = <T>(path: string, body?: unknown) => apiClient.patch<T>(path, body);

export const keys = {
  planning: (propertyId: string, from: string, to: string) =>
    ['planning', propertyId, from, to] as const,
  planningAll: ['planning'] as const,
  reservations: ['reservations'] as const,
  reservation: (id: string) => ['reservation', id] as const,
  waitlist: ['waitlist'] as const,
  groups: ['groups'] as const,
};

export function planningPath(propertyId: string, from: string, to: string) {
  return `/planning${qs({ propertyId, from, to })}`;
}

/** Day-to-day helpers on `YYYY-MM-DD` strings (UTC, no time zone surprises). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
export function formatDayShort(day: string, locale = 'fr'): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
export function formatDayLong(day: string, locale = 'fr'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export interface ConflictDetails {
  clashes: { roomId: string; date: string; reason: string }[];
  short: { roomTypeId: string; date: string; free: number; needed: number }[];
}

/** Clash details of a 409 (`meta.clashes` / `meta.short`), empty for any other error. */
export function conflictDetails(err: unknown): ConflictDetails | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const meta = err.meta ?? {};
  const clashes = Array.isArray(meta['clashes'])
    ? (meta['clashes'] as ConflictDetails['clashes'])
    : [];
  const short = Array.isArray(meta['short']) ? (meta['short'] as ConflictDetails['short']) : [];
  return { clashes, short };
}

export { ApiError };

/**
 * Penalty PREVIEW shown before cancelling / marking a no-show (OP-14): the server computes it with
 * the same policy and maths as the action itself (`GET /reservations/:id/cancellation-preview`).
 * `null` data when the preview cannot be read (the modal then says it is unknown).
 */
export function usePenaltyPreview(
  reservation: Reservation | undefined,
  kind: 'CANCELLATION' | 'NO_SHOW',
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['penalty-preview', reservation?.id, reservation?.updatedAt, kind],
    enabled: enabled && !!reservation,
    retry: false,
    queryFn: async () => {
      try {
        return await get<Penalty>(
          `/reservations/${reservation!.id}/cancellation-preview${qs({ kind })}`,
        );
      } catch {
        return null;
      }
    },
  });
}
