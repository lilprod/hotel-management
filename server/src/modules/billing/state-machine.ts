import { addDays, type IsoDate } from './domain.js';

/**
 * Subscription state machine (doc 02 §2) — pure, no I/O.
 *
 *   TRIALING ──payment──► ACTIVE ──due date unpaid──► PAST_DUE ──payment──► ACTIVE
 *      │ trial ends unpaid                               │ grace (G days) elapsed
 *      ▼                                                  ▼
 *   SUSPENDED (read only) ◄───────────────────────────────┘
 *      │ suspended > R days, or cancellation
 *      ▼
 *   CANCELLED (export only) ──► purge after the retention period
 *
 * Reactivation: a settling payment (SUSPENDED → ACTIVE) or a Super Admin action (also from
 * CANCELLED, before the purge).
 */
export type SubStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export type LifecycleTrigger =
  /** The invoice(s) due are fully paid. */
  | 'PAYMENT_SETTLED'
  /** Trial end reached without a paid period. */
  | 'TRIAL_EXPIRED'
  /** An invoice is unpaid after its due date. */
  | 'INVOICE_OVERDUE'
  /** The grace period after the due date elapsed. */
  | 'GRACE_EXPIRED'
  /** Suspended for more than R days. */
  | 'SUSPENSION_EXPIRED'
  /** Cancellation scheduled at the period end (`cancel_at`) reached. */
  | 'SCHEDULED_CANCEL'
  | 'ADMIN_SUSPEND'
  | 'ADMIN_REACTIVATE'
  | 'ADMIN_CANCEL';

export const TRANSITIONS: Readonly<
  Record<SubStatus, Readonly<Partial<Record<LifecycleTrigger, SubStatus>>>>
> = {
  TRIALING: {
    PAYMENT_SETTLED: 'ACTIVE',
    TRIAL_EXPIRED: 'SUSPENDED',
    ADMIN_SUSPEND: 'SUSPENDED',
    ADMIN_CANCEL: 'CANCELLED',
    SCHEDULED_CANCEL: 'CANCELLED',
  },
  ACTIVE: {
    INVOICE_OVERDUE: 'PAST_DUE',
    // A reversed payment re-evaluated after the grace period jumps straight to SUSPENDED.
    GRACE_EXPIRED: 'SUSPENDED',
    ADMIN_SUSPEND: 'SUSPENDED',
    ADMIN_CANCEL: 'CANCELLED',
    SCHEDULED_CANCEL: 'CANCELLED',
  },
  PAST_DUE: {
    PAYMENT_SETTLED: 'ACTIVE',
    GRACE_EXPIRED: 'SUSPENDED',
    ADMIN_SUSPEND: 'SUSPENDED',
    ADMIN_CANCEL: 'CANCELLED',
    SCHEDULED_CANCEL: 'CANCELLED',
  },
  SUSPENDED: {
    PAYMENT_SETTLED: 'ACTIVE',
    ADMIN_REACTIVATE: 'ACTIVE',
    SUSPENSION_EXPIRED: 'CANCELLED',
    ADMIN_CANCEL: 'CANCELLED',
    SCHEDULED_CANCEL: 'CANCELLED',
  },
  CANCELLED: {
    ADMIN_REACTIVATE: 'ACTIVE',
  },
};

export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError';
  constructor(
    readonly from: SubStatus,
    readonly trigger: LifecycleTrigger,
  ) {
    super(`Transition ${trigger} is not allowed from ${from}`);
  }
}

export function canTransition(from: SubStatus, trigger: LifecycleTrigger): boolean {
  return TRANSITIONS[from][trigger] !== undefined;
}

export function transition(from: SubStatus, trigger: LifecycleTrigger): SubStatus {
  const to = TRANSITIONS[from][trigger];
  if (!to) throw new InvalidTransitionError(from, trigger);
  return to;
}

/** Facts the daily evaluation needs (dates are local calendar dates of the tenant). */
export interface SubscriptionFacts {
  status: SubStatus;
  trialEndsAt: IsoDate | null;
  graceEndsAt: IsoDate | null;
  cancelAt: IsoDate | null;
  /** Date of the last transition to SUSPENDED. */
  suspendedSince: IsoDate | null;
  /** Earliest due date of a non-void invoice with an outstanding balance. */
  oldestUnpaidDueDate: IsoDate | null;
}

export interface LifecyclePolicy {
  /** G: days after the due date before suspension (default 7). */
  graceDays: number;
  /** R: days in SUSPENDED before cancellation (default 90). */
  suspensionDays: number;
}

export interface Decision {
  trigger: LifecycleTrigger;
  from: SubStatus;
  to: SubStatus;
  /** New `grace_ends_at` (`null` clears it, undefined keeps it). */
  graceEndsAt?: IsoDate | null;
}

const decide = (
  from: SubStatus,
  trigger: LifecycleTrigger,
  extra: Partial<Decision> = {},
): Decision => ({ trigger, from, to: transition(from, trigger), ...extra });

/**
 * Daily evaluation (`subscription-lifecycle` job, and after a payment reversal): returns the
 * transition to apply today, or `null`. Never reactivates a SUSPENDED / CANCELLED subscription
 * (only a payment or a Super Admin does).
 */
export function evaluate(
  s: SubscriptionFacts,
  today: IsoDate,
  policy: LifecyclePolicy,
): Decision | null {
  const overdue = s.oldestUnpaidDueDate !== null && today > s.oldestUnpaidDueDate;
  const graceEnd = s.oldestUnpaidDueDate ? addDays(s.oldestUnpaidDueDate, policy.graceDays) : null;
  const scheduledCancel = s.cancelAt !== null && today >= s.cancelAt;

  switch (s.status) {
    case 'TRIALING':
      if (scheduledCancel) return decide('TRIALING', 'SCHEDULED_CANCEL');
      if (s.trialEndsAt !== null && today >= s.trialEndsAt)
        return decide('TRIALING', 'TRIAL_EXPIRED', { graceEndsAt: null });
      return null;
    case 'ACTIVE':
      if (scheduledCancel) return decide('ACTIVE', 'SCHEDULED_CANCEL');
      if (!overdue) return null;
      if (graceEnd !== null && today >= graceEnd)
        return decide('ACTIVE', 'GRACE_EXPIRED', { graceEndsAt: graceEnd });
      return decide('ACTIVE', 'INVOICE_OVERDUE', { graceEndsAt: graceEnd });
    case 'PAST_DUE': {
      if (scheduledCancel) return decide('PAST_DUE', 'SCHEDULED_CANCEL');
      if (!overdue) return decide('PAST_DUE', 'PAYMENT_SETTLED', { graceEndsAt: null });
      const end = s.graceEndsAt ?? graceEnd;
      if (end !== null && today >= end) return decide('PAST_DUE', 'GRACE_EXPIRED');
      return null;
    }
    case 'SUSPENDED':
      if (scheduledCancel) return decide('SUSPENDED', 'SCHEDULED_CANCEL');
      if (s.suspendedSince !== null && today >= addDays(s.suspendedSince, policy.suspensionDays))
        return decide('SUSPENDED', 'SUSPENSION_EXPIRED');
      return null;
    case 'CANCELLED':
      return null;
  }
}

/** Statuses a settling payment reactivates (doc 02 §4.2). */
export const REACTIVABLE_BY_PAYMENT: readonly SubStatus[] = ['TRIALING', 'PAST_DUE', 'SUSPENDED'];
