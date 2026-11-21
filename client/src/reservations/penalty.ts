import { useQuery } from '@tanstack/react-query';

import { get, qs } from './api';
import type { Reservation } from './api';
import { useBusinessDate } from './refs';

/**
 * Penalty PREVIEW shown before cancelling / marking a no-show (OP-14). The server stays the
 * authority (it recomputes and stores the penalty on the action); this mirrors its pure
 * `computePenalty` (server/src/modules/reservations/lifecycle.ts) on the cancellation policy of
 * each rate plan, so the staff member sees the amount before confirming.
 */

export interface CancellationRules {
  tiers: { daysBefore: number; penaltyPercent: number }[];
  noShowPercent: number;
  firstNightMinimum: boolean;
}

const DAY_MS = 86_400_000;
const dayMs = (s: string) => Date.parse(`${s}T00:00:00.000Z`);

export function computePenalty(
  rules: CancellationRules | null,
  input: {
    today: string;
    arrival: string;
    stayTotal: number;
    firstNight: number;
    noShow?: boolean;
  },
) {
  const daysBefore = Math.round((dayMs(input.arrival) - dayMs(input.today)) / DAY_MS);
  if (!rules) return { percent: 0, amount: 0, daysBefore, tier: null as number | null };
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

interface PolicyRow {
  id: string;
  kind: 'CANCELLATION' | 'DEPOSIT';
  rules: Record<string, unknown>;
}
interface RatePlanRow {
  id: string;
  cancellationPolicyId?: string | null;
}

export interface PenaltyPreview {
  amount: number;
  currency: string;
  percent: number;
  daysBefore: number;
}

const HOLDING = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];

/** Preview of the penalty of `kind` for a reservation; `null` data when the policies are not readable. */
export function usePenaltyPreview(
  reservation: Reservation | undefined,
  kind: 'CANCELLATION' | 'NO_SHOW',
  enabled: boolean,
) {
  const propertyId = reservation?.propertyId ?? null;
  const businessDate = useBusinessDate(propertyId);
  return useQuery({
    queryKey: ['penalty-preview', reservation?.id, reservation?.updatedAt, kind, businessDate.data],
    enabled: enabled && !!reservation && !!businessDate.data,
    retry: false,
    queryFn: async (): Promise<PenaltyPreview | null> => {
      const r = reservation!;
      const today = businessDate.data!;
      let plans: RatePlanRow[];
      let policies: PolicyRow[];
      try {
        [plans, policies] = await Promise.all([
          get<{ items: RatePlanRow[] }>(
            `/pricing/rate-plans${qs({ propertyId: r.propertyId, limit: 200 })}`,
          ).then((x) => x.items),
          get<{ items: PolicyRow[] }>(
            `/pricing/policies${qs({ propertyId: r.propertyId, limit: 200 })}`,
          ).then((x) => x.items),
        ]);
      } catch {
        return null;
      }
      const policyOf = new Map(
        plans.map((p) => [p.id, policies.find((x) => x.id === p.cancellationPolicyId)]),
      );
      let amount = 0;
      let percent = 0;
      let daysBefore = 0;
      for (const line of r.rooms.filter((l) => HOLDING.includes(l.status))) {
        const policy = policyOf.get(line.ratePlanId);
        // An option (PENDING) is not guaranteed: cancelling it costs nothing.
        const rules =
          line.status === 'PENDING' || !policy || policy.kind !== 'CANCELLATION'
            ? null
            : (policy.rules as unknown as CancellationRules);
        const p = computePenalty(rules, {
          today,
          arrival: line.arrival,
          stayTotal: line.dailyPrices.reduce((s, n) => s + n.total, 0),
          firstNight: line.dailyPrices[0]?.total ?? 0,
          noShow: kind === 'NO_SHOW',
        });
        amount += p.amount;
        percent = Math.max(percent, p.percent);
        daysBefore = p.daysBefore;
      }
      return { amount, currency: r.currency, percent, daysBefore };
    },
  });
}
