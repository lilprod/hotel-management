/**
 * Reservation lifecycle (OP-13) and cancellation penalties (OP-14). Pure functions, no I/O.
 *
 *   PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT → COMPLETED
 *   PENDING | CONFIRMED → CANCELLED ;  CONFIRMED → NO_SHOW
 */

export const RESERVATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type ReservationStatusName = (typeof RESERVATION_STATUSES)[number];

export const TRANSITIONS: Readonly<
  Record<ReservationStatusName, readonly ReservationStatusName[]>
> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Statuses whose stay (dates, rooms, rate) may still be modified. */
export const EDITABLE_STATUSES: readonly ReservationStatusName[] = ['PENDING', 'CONFIRMED'];

export interface TransitionFacts {
  /** Business date of the property (YYYY-MM-DD). */
  businessDate: string;
  arrival: string;
  departure: string;
  /** Every room line has a unit (mandatory at check-in). */
  allRoomsAssigned?: boolean;
  /** Folio balance is zero (COMPLETED once the folio is settled). */
  folioSettled?: boolean;
}

export type GuardResult = { ok: true } | { ok: false; reason: string; message: string };

const fail = (reason: string, message: string): GuardResult => ({ ok: false, reason, message });

/** Transition guard: status graph plus the business rules of each target status. */
export function guardTransition(
  from: ReservationStatusName,
  to: ReservationStatusName,
  facts: TransitionFacts,
): GuardResult {
  if (!TRANSITIONS[from].includes(to))
    return fail('INVALID_TRANSITION', `A ${from} reservation cannot become ${to}`);
  switch (to) {
    case 'CHECKED_IN':
      if (facts.arrival > facts.businessDate)
        return fail('TOO_EARLY', 'Check-in is only possible from the arrival business date');
      if (facts.departure <= facts.businessDate)
        return fail('STAY_OVER', 'The stay is already over');
      if (!facts.allRoomsAssigned)
        return fail('ROOM_NOT_ASSIGNED', 'Every room must be assigned before check-in');
      return { ok: true };
    case 'NO_SHOW':
      if (facts.arrival > facts.businessDate)
        return fail('TOO_EARLY', 'No-show is only possible from the arrival business date');
      return { ok: true };
    case 'COMPLETED':
      if (!facts.folioSettled) return fail('FOLIO_NOT_SETTLED', 'The folio is not settled');
      return { ok: true };
    case 'CANCELLED':
      if (from === 'CONFIRMED' && facts.departure <= facts.businessDate)
        return fail('STAY_OVER', 'A past stay cannot be cancelled');
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function canTransition(
  from: ReservationStatusName,
  to: ReservationStatusName,
  facts: TransitionFacts,
): boolean {
  return guardTransition(from, to, facts).ok;
}

// ─────────────────────────── cancellation penalty ───────────────────────────

export interface CancellationRules {
  tiers: readonly { daysBefore: number; penaltyPercent: number }[];
  noShowPercent: number;
  firstNightMinimum: boolean;
}

export interface PenaltyInput {
  /** Day the cancellation happens (business date). */
  today: string;
  arrival: string;
  /** Stay amount the percentage applies to (integer minor units). */
  stayTotal: number;
  /** Amount of the first night (firstNightMinimum). */
  firstNight: number;
  noShow?: boolean;
}

export interface Penalty {
  percent: number;
  amount: number;
  daysBefore: number;
  /** Tier applied (`daysBefore` of the tier), null for the no-show / late rate. */
  tier: number | null;
}

const DAY_MS = 86_400_000;
const dayMs = (s: string) => Date.parse(`${s}T00:00:00.000Z`);

/**
 * Penalty of one reservation room. Tiers: cancelling at least `daysBefore` days before arrival
 * costs `penaltyPercent` (the tier with the largest `daysBefore` that is still reached wins);
 * later than every tier, and on no-show, `noShowPercent` applies. `firstNightMinimum`: a non-zero
 * penalty is never below the first night. Amounts are integers, rounded half up.
 */
export function computePenalty(rules: CancellationRules | null, input: PenaltyInput): Penalty {
  const daysBefore = Math.round((dayMs(input.arrival) - dayMs(input.today)) / DAY_MS);
  if (!rules) return { percent: 0, amount: 0, daysBefore, tier: null };
  let percent = rules.noShowPercent;
  let tier: number | null = null;
  if (!input.noShow) {
    const reached = rules.tiers
      .filter((t) => daysBefore >= t.daysBefore)
      .sort((a, b) => b.daysBefore - a.daysBefore)[0];
    if (reached) {
      percent = reached.penaltyPercent;
      tier = reached.daysBefore;
    }
  }
  let amount = Math.floor((input.stayTotal * percent + 50) / 100);
  if (percent > 0 && rules.firstNightMinimum && amount < input.firstNight)
    amount = Math.min(input.firstNight, input.stayTotal);
  return { percent, amount, daysBefore, tier };
}
