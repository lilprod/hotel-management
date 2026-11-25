import { useQuery } from '@tanstack/react-query';

import { get, qs } from '../../reservations/api';

/** Night audit API (`/api/v1/t/night-audit`); types mirror the server Zod schemas (L8b). */

export const STEPS = [
  'no_shows',
  'room_nights',
  'lock_day',
  'stats',
  'advance_date',
  'report',
  'notify',
] as const;
export type Step = (typeof STEPS)[number];

export type CheckCode =
  | 'PENDING_ARRIVALS'
  | 'PENDING_DEPARTURES'
  | 'OPEN_CASH_SESSIONS'
  | 'NEGATIVE_BALANCES'
  | 'UNASSIGNED_IN_HOUSE';

export interface CheckItem {
  reservationId?: string;
  reservationRoomId?: string;
  stayId?: string | null;
  number?: string;
  guestName?: string;
  roomNumber?: string | null;
  arrival?: string;
  departure?: string;
  balance?: number;
  currency?: string;
  penalty?: { amount: number; currency: string } | null;
  canNoShow?: boolean;
  folioId?: string;
  cashSessionId?: string;
  userId?: string;
  userName?: string;
  openedAt?: string;
}

export interface Check {
  code: CheckCode;
  severity: 'DECISION' | 'WARNING' | 'BLOCKING';
  count: number;
  items: CheckItem[];
}

export interface Precheck {
  propertyId: string;
  businessDate: string;
  closedDate: string | null;
  running: { id: string; status: string; startedAt: string } | null;
  checks: Check[];
  canRun: boolean;
}

export interface Kpis {
  businessDate: string;
  currency: string;
  roomsAvailable: number;
  roomsSold: number;
  occupancy: string;
  roomRevenue: number;
  totalRevenue: number;
  adr: number;
  revpar: number;
  revenueByDept: Record<string, number>;
  taxes: { code: string; name: string; kind: 'VAT' | 'TOURIST'; amount: number }[];
  vatTotal: number;
  touristTaxTotal: number;
  payments: { method: string; amount: number }[];
  paymentsTotal: number;
  arrivals: number;
  departures: number;
  inHouse: number;
  noShows: number;
}

export interface Audit {
  id: string;
  propertyId: string;
  businessDate: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  trigger: 'manual' | 'auto';
  startedBy: string | null;
  startedAt: string;
  completedAt: string | null;
  steps: { step: Step; status: 'pending' | 'done' | 'failed'; at: string | null; error: string | null }[];
  decisions: Decision[];
  warnings: { code: string; count: number }[];
  kpis: Kpis | null;
  reportFileId: string | null;
  error: string | null;
}

export interface Decision {
  reservationId: string;
  action: 'NO_SHOW' | 'KEEP';
  waivePenalty?: boolean;
}

export interface RunResult {
  audit: Audit;
  alreadyCompleted: boolean;
}

/** Realtime `night_audit.progress` payload. */
export interface Progress {
  propertyId: string;
  auditId: string;
  businessDate: string;
  step: Step;
  index: number;
  total: number;
  status: 'running' | 'done' | 'failed';
  error?: string;
}

export const naKeys = {
  all: ['night-audit'] as const,
  precheck: (p: string | null) => ['night-audit', 'precheck', p] as const,
  history: (p: string | null) => ['night-audit', 'history', p] as const,
};

export function usePrecheck(propertyId: string | null) {
  return useQuery({
    queryKey: naKeys.precheck(propertyId),
    queryFn: () => get<Precheck>(`/night-audit/precheck${qs({ propertyId })}`),
    enabled: !!propertyId,
  });
}

export function useHistory(propertyId: string | null) {
  return useQuery({
    queryKey: naKeys.history(propertyId),
    queryFn: () => get<{ items: Audit[]; nextCursor: string | null }>(`/night-audit${qs({ propertyId, limit: 30 })}`),
    enabled: !!propertyId,
  });
}

/** Initial decision of a pending arrival: keep it (the safe choice) until the user picks no-show. */
export function defaultDecisions(p: Precheck | undefined): Record<string, Decision> {
  const out: Record<string, Decision> = {};
  for (const i of p?.checks.find((c) => c.code === 'PENDING_ARRIVALS')?.items ?? [])
    if (i.reservationId) out[i.reservationId] = { reservationId: i.reservationId, action: 'KEEP' };
  return out;
}

/** Step statuses shown while running: the last known audit state overlaid with live progress. */
export function stepStatuses(
  audit: Pick<Audit, 'steps'> | null,
  live: Partial<Record<Step, Progress['status']>>,
): Record<Step, 'wait' | 'process' | 'finish' | 'error'> {
  const out = {} as Record<Step, 'wait' | 'process' | 'finish' | 'error'>;
  for (const s of STEPS) {
    const known = audit?.steps.find((x) => x.step === s)?.status;
    const l = live[s];
    out[s] =
      l === 'failed' || (!l && known === 'failed')
        ? 'error'
        : l === 'done' || known === 'done'
          ? 'finish'
          : l === 'running'
            ? 'process'
            : 'wait';
  }
  return out;
}
