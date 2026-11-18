import { describe, expect, it } from 'vitest';
import {
  addMonths,
  allocateOldestFirst,
  couponDiscount,
  diffDays,
  invoiceStatusOf,
  localDate,
  localMinutes,
  percentToBps,
  periodEndOf,
  prorata,
  taxOf,
} from '../src/modules/billing/domain.js';
import {
  canTransition,
  evaluate,
  InvalidTransitionError,
  transition,
  TRANSITIONS,
  type LifecycleTrigger,
  type SubscriptionFacts,
  type SubStatus,
} from '../src/modules/billing/state-machine.js';

describe('billing arithmetic', () => {
  it('adds months with end-of-month clamping and computes cycles', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(periodEndOf('2026-12-01', 'YEARLY')).toBe('2027-12-01');
    expect(diffDays('2026-11-01', '2026-12-01')).toBe(30);
  });

  it.each([
    // new, old, remaining, period → expected
    [100_000n, 50_000n, 15, 30, 25_000n],
    [100_000n, 50_000n, 30, 30, 50_000n],
    [100_000n, 50_000n, 0, 30, 0n],
    [50_000n, 100_000n, 15, 30, 0n], // downgrade: no negative prorata
    [50_000n, 25_000n, 10, 31, 8_065n], // 25 000 × 10 / 31 = 8064.5 → half up
    [50_000n, 25_000n, 40, 30, 25_000n], // remaining capped at the period
  ])('prorata(%s, %s, %i/%i) = %s', (n, o, r, p, expected) => {
    expect(prorata(n, o, r, p)).toBe(expected);
  });

  it('computes VAT in integers (half up) and parses percentages without floats', () => {
    expect(taxOf(25_000n, 1800)).toBe(4_500n);
    expect(taxOf(25_003n, 1800)).toBe(4_501n); // 4500.54
    expect(taxOf(1_000n, 0)).toBe(0n);
    expect(percentToBps('18')).toBe(1800);
    expect(percentToBps('12.5')).toBe(1250);
    expect(() => percentToBps('abc')).toThrow();
  });

  it('applies coupons: percent, amount (capped), duration, free months', () => {
    const pct = { type: 'PERCENT' as const, value: '10', duration: 2 };
    expect(couponDiscount(pct, 50_000n, 'MONTHLY', 0)).toBe(5_000n);
    expect(couponDiscount(pct, 50_000n, 'MONTHLY', 2)).toBe(0n);
    const amt = { type: 'AMOUNT' as const, value: '80000', duration: null };
    expect(couponDiscount(amt, 50_000n, 'MONTHLY', 12)).toBe(50_000n);
    const free = { type: 'FREE_MONTHS' as const, value: '2', duration: null };
    expect(couponDiscount(free, 25_000n, 'MONTHLY', 0)).toBe(25_000n);
    expect(couponDiscount(free, 25_000n, 'MONTHLY', 2)).toBe(0n);
    expect(couponDiscount(free, 75_000n, 'QUARTERLY', 0)).toBe(50_000n);
  });

  it('allocates oldest open invoice first and returns the remainder', () => {
    const inv = (id: string, due: string, balance: bigint) => ({
      id,
      dueDate: due,
      issueDate: due,
      number: id,
      balance,
    });
    const r = allocateOldestFirst(70_000n, [
      inv('b', '2026-11-20', 50_000n),
      inv('a', '2026-10-20', 30_000n),
      inv('c', '2026-12-20', 0n),
    ]);
    expect(r.allocations).toEqual([
      { invoiceId: 'a', amount: 30_000n },
      { invoiceId: 'b', amount: 40_000n },
    ]);
    expect(r.remainder).toBe(0n);
    expect(allocateOldestFirst(90_000n, [inv('a', '2026-10-20', 30_000n)]).remainder).toBe(60_000n);
  });

  it('derives invoice status from paid amount', () => {
    expect(invoiceStatusOf('ISSUED', 100n, 0n)).toBe('ISSUED');
    expect(invoiceStatusOf('ISSUED', 100n, 40n)).toBe('PARTIALLY_PAID');
    expect(invoiceStatusOf('PARTIALLY_PAID', 100n, 100n)).toBe('PAID');
    expect(invoiceStatusOf('PAID', 100n, 0n)).toBe('ISSUED'); // re-opened by a reversal
    expect(invoiceStatusOf('VOID', 100n, 0n)).toBe('VOID');
  });

  it('computes local dates and times in the tenant time zone', () => {
    const now = new Date('2026-11-18T23:30:00Z');
    expect(localDate(now, 'Africa/Lome')).toBe('2026-11-18');
    expect(localDate(now, 'Asia/Tokyo')).toBe('2026-11-19');
    expect(localMinutes(new Date('2026-11-18T00:15:00Z'), 'Africa/Lome')).toBe(15);
  });
});

describe('subscription state machine', () => {
  const ALL: SubStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];
  const TRIGGERS: LifecycleTrigger[] = [
    'PAYMENT_SETTLED',
    'TRIAL_EXPIRED',
    'INVOICE_OVERDUE',
    'GRACE_EXPIRED',
    'SUSPENSION_EXPIRED',
    'SCHEDULED_CANCEL',
    'ADMIN_SUSPEND',
    'ADMIN_REACTIVATE',
    'ADMIN_CANCEL',
  ];

  it.each([
    ['TRIALING', 'PAYMENT_SETTLED', 'ACTIVE'],
    ['TRIALING', 'TRIAL_EXPIRED', 'SUSPENDED'],
    ['ACTIVE', 'INVOICE_OVERDUE', 'PAST_DUE'],
    ['PAST_DUE', 'PAYMENT_SETTLED', 'ACTIVE'],
    ['PAST_DUE', 'GRACE_EXPIRED', 'SUSPENDED'],
    ['SUSPENDED', 'PAYMENT_SETTLED', 'ACTIVE'],
    ['SUSPENDED', 'SUSPENSION_EXPIRED', 'CANCELLED'],
    ['SUSPENDED', 'ADMIN_REACTIVATE', 'ACTIVE'],
    ['CANCELLED', 'ADMIN_REACTIVATE', 'ACTIVE'],
    ['ACTIVE', 'ADMIN_CANCEL', 'CANCELLED'],
  ] as [SubStatus, LifecycleTrigger, SubStatus][])('%s --%s--> %s', (from, trigger, to) => {
    expect(transition(from, trigger)).toBe(to);
  });

  it('refuses every transition outside the table', () => {
    for (const from of ALL)
      for (const t of TRIGGERS) {
        const allowed = TRANSITIONS[from][t] !== undefined;
        expect(canTransition(from, t)).toBe(allowed);
        if (!allowed) expect(() => transition(from, t)).toThrow(InvalidTransitionError);
      }
    expect(canTransition('CANCELLED', 'PAYMENT_SETTLED')).toBe(false);
    expect(canTransition('ACTIVE', 'TRIAL_EXPIRED')).toBe(false);
  });

  const base: SubscriptionFacts = {
    status: 'ACTIVE',
    trialEndsAt: null,
    graceEndsAt: null,
    cancelAt: null,
    suspendedSince: null,
    oldestUnpaidDueDate: null,
  };
  const policy = { graceDays: 7, suspensionDays: 90 };

  it.each([
    // [facts, today, expected (to, trigger) or null]
    [{ status: 'TRIALING', trialEndsAt: '2026-12-01' }, '2026-11-30', null],
    [
      { status: 'TRIALING', trialEndsAt: '2026-12-01' },
      '2026-12-01',
      ['SUSPENDED', 'TRIAL_EXPIRED'],
    ],
    [{ oldestUnpaidDueDate: '2026-12-01' }, '2026-12-01', null],
    [{ oldestUnpaidDueDate: '2026-12-01' }, '2026-12-02', ['PAST_DUE', 'INVOICE_OVERDUE']],
    [{ oldestUnpaidDueDate: '2026-12-01' }, '2026-12-09', ['SUSPENDED', 'GRACE_EXPIRED']],
    [
      { status: 'PAST_DUE', oldestUnpaidDueDate: '2026-12-01', graceEndsAt: '2026-12-08' },
      '2026-12-07',
      null,
    ],
    [
      { status: 'PAST_DUE', oldestUnpaidDueDate: '2026-12-01', graceEndsAt: '2026-12-08' },
      '2026-12-08',
      ['SUSPENDED', 'GRACE_EXPIRED'],
    ],
    [
      { status: 'PAST_DUE', oldestUnpaidDueDate: null },
      '2026-12-05',
      ['ACTIVE', 'PAYMENT_SETTLED'],
    ],
    [{ status: 'SUSPENDED', suspendedSince: '2026-09-01' }, '2026-11-29', null],
    [
      { status: 'SUSPENDED', suspendedSince: '2026-09-01' },
      '2026-11-30',
      ['CANCELLED', 'SUSPENSION_EXPIRED'],
    ],
    [{ status: 'SUSPENDED', oldestUnpaidDueDate: null }, '2026-11-30', null], // never auto-reactivated
    [{ cancelAt: '2026-12-01' }, '2026-12-01', ['CANCELLED', 'SCHEDULED_CANCEL']],
    [{ status: 'CANCELLED' }, '2030-01-01', null],
  ] as [Partial<SubscriptionFacts>, string, [SubStatus, LifecycleTrigger] | null][])(
    'evaluate(%j, %s)',
    (facts, today, expected) => {
      const d = evaluate({ ...base, ...facts }, today, policy);
      if (!expected) expect(d).toBeNull();
      else expect(d).toMatchObject({ to: expected[0], trigger: expected[1] });
    },
  );

  it('sets the grace end when moving to PAST_DUE', () => {
    const d = evaluate({ ...base, oldestUnpaidDueDate: '2026-12-01' }, '2026-12-02', policy);
    expect(d?.graceEndsAt).toBe('2026-12-08');
  });
});
