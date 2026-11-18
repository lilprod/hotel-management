import type { Services } from '../../core/container.js';
import { dateOf, isoOf, num } from './common.js';
import { CYCLE_MONTHS, diffDays, mulDivRound, type Cycle, type IsoDate } from './domain.js';
import { planPriceOn } from './invoices.js';

/** SA-38: collections by method and period (day or month buckets), confirmed payments only. */
export async function collectionsReport(
  services: Services,
  q: { from: IsoDate; to: IsoDate; groupBy: 'day' | 'month'; currency?: string | undefined },
) {
  const rows = await services.admin.payment.findMany({
    where: {
      status: 'CONFIRMED',
      paidAt: { gte: dateOf(q.from), lte: dateOf(q.to) },
      ...(q.currency ? { currency: q.currency } : {}),
    },
    select: { paidAt: true, method: true, amount: true, currency: true },
  });
  const buckets = new Map<
    string,
    { period: string; method: string; currency: string; amount: bigint; count: number }
  >();
  const totals = new Map<string, bigint>();
  for (const r of rows) {
    const day = isoOf(r.paidAt);
    const period = q.groupBy === 'month' ? day.slice(0, 7) : day;
    const key = `${period}|${r.method}|${r.currency}`;
    const b = buckets.get(key) ?? {
      period,
      method: r.method,
      currency: r.currency,
      amount: 0n,
      count: 0,
    };
    b.amount += r.amount;
    b.count += 1;
    buckets.set(key, b);
    const tk = `${r.method}|${r.currency}`;
    totals.set(tk, (totals.get(tk) ?? 0n) + r.amount);
  }
  return {
    from: q.from,
    to: q.to,
    groupBy: q.groupBy,
    rows: [...buckets.values()]
      .sort((a, b) => a.period.localeCompare(b.period) || a.method.localeCompare(b.method))
      .map((b) => ({ ...b, amount: num(b.amount) })),
    totalsByMethod: [...totals.entries()].map(([k, v]) => {
      const [method, currency] = k.split('|');
      return { method, currency, amount: num(v) };
    }),
  };
}

const AGING_BUCKETS = [
  { key: 'current', min: Number.NEGATIVE_INFINITY, max: 0 },
  { key: 'd1_30', min: 1, max: 30 },
  { key: 'd31_60', min: 31, max: 60 },
  { key: 'd61_90', min: 61, max: 90 },
  { key: 'd90_plus', min: 91, max: Number.POSITIVE_INFINITY },
] as const;

type AgingKey = (typeof AGING_BUCKETS)[number]['key'];

/** SA-38: aged receivables per tenant (outstanding balance by days past due). */
export async function agedReceivables(services: Services, asOf: IsoDate) {
  const invoices = await services.admin.platformInvoice.findMany({
    where: {
      status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
      issueDate: { lte: dateOf(asOf) },
    },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
  });
  const empty = (): Record<AgingKey, bigint> => ({
    current: 0n,
    d1_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90_plus: 0n,
  });
  const byTenant = new Map<
    string,
    {
      tenant: { id: string; name: string; slug: string };
      currency: string;
      b: Record<AgingKey, bigint>;
    }
  >();
  const totals = empty();
  for (const i of invoices) {
    const balance = i.total - i.amountPaid;
    if (balance <= 0n) continue;
    const late = diffDays(isoOf(i.dueDate), asOf);
    const bucket = AGING_BUCKETS.find((b) => late >= b.min && late <= b.max)!.key;
    const key = `${i.tenantId}|${i.currency}`;
    const row = byTenant.get(key) ?? { tenant: i.tenant, currency: i.currency, b: empty() };
    row.b[bucket] += balance;
    totals[bucket] += balance;
    byTenant.set(key, row);
  }
  const toNum = (r: Record<AgingKey, bigint>) => {
    const out = {} as Record<AgingKey | 'total', number>;
    let total = 0n;
    for (const k of Object.keys(r) as AgingKey[]) {
      out[k] = num(r[k]);
      total += r[k];
    }
    out.total = num(total);
    return out;
  };
  return {
    asOf,
    rows: [...byTenant.values()]
      .map((r) => ({ tenant: r.tenant, currency: r.currency, ...toNum(r.b) }))
      .sort((a, b) => b.total - a.total),
    totals: toNum(totals),
  };
}

/** SA-01: MRR / ARR (monthly equivalent of ACTIVE and PAST_DUE subscriptions), by currency. */
export async function recurringRevenue(services: Services, asOf: IsoDate) {
  const subs = await services.admin.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, tenant: { deletedAt: null } },
    include: { tenant: { select: { defaultCurrency: true } } },
  });
  const mrr = new Map<string, bigint>();
  for (const s of subs) {
    const cycle = s.billingCycle as Cycle;
    const price = await planPriceOn(
      services.admin,
      s.planId,
      cycle,
      s.tenant.defaultCurrency,
      asOf,
    );
    if (price === null) continue;
    const monthly = mulDivRound(price, 1n, BigInt(CYCLE_MONTHS[cycle]));
    mrr.set(s.tenant.defaultCurrency, (mrr.get(s.tenant.defaultCurrency) ?? 0n) + monthly);
  }
  return {
    asOf,
    subscriptions: subs.length,
    byCurrency: [...mrr.entries()].map(([currency, m]) => ({
      currency,
      mrr: num(m),
      arr: num(m * 12n),
    })),
  };
}

/** SA-01: tenants by subscription status (latest subscription of each tenant). */
export async function tenantsByStatus(services: Services) {
  const rows = await services.admin.$queryRaw<{ status: string; count: bigint }[]>`
    SELECT s.status::text AS status, count(*)::bigint AS count
    FROM tenants t
    JOIN LATERAL (
      SELECT status FROM subscriptions WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
    WHERE t.deleted_at IS NULL
    GROUP BY s.status`;
  const out: Record<string, number> = {
    TRIALING: 0,
    ACTIVE: 0,
    PAST_DUE: 0,
    SUSPENDED: 0,
    CANCELLED: 0,
  };
  for (const r of rows) out[r.status] = num(r.count);
  return out;
}

/** SA-01: trial conversions over a period (TRIALING → ACTIVE vs trials that ended unpaid). */
export async function trialConversions(services: Services, from: IsoDate, to: IsoDate) {
  const range = { gte: dateOf(from), lt: new Date(dateOf(to).getTime() + 86_400_000) };
  const [converted, lost, started] = await Promise.all([
    services.admin.subscriptionEvent.count({
      where: { fromStatus: 'TRIALING', toStatus: 'ACTIVE', createdAt: range },
    }),
    services.admin.subscriptionEvent.count({
      where: {
        fromStatus: 'TRIALING',
        toStatus: { in: ['SUSPENDED', 'CANCELLED'] },
        createdAt: range,
      },
    }),
    services.admin.subscriptionEvent.count({
      where: { fromStatus: null, toStatus: 'TRIALING', createdAt: range },
    }),
  ]);
  const ended = converted + lost;
  return {
    from,
    to,
    started,
    converted,
    lost,
    conversionRateBps: ended ? Math.round((converted * 10_000) / ended) : null,
  };
}
