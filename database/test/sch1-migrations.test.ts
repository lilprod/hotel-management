/**
 * SCH-1 data migrations: the workaround data written by earlier versions (settings keys, JSON
 * snapshots, label prefixes, file-name lookups…) is moved into the new columns / tables.
 *
 * A dedicated throwaway cluster is migrated up to the last pre-SCH-1 migration, filled with
 * seeded-like fixtures in the old shape, then the SCH-1 migrations are applied with psql.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from './pg.js';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const FIRST_SCH1 = '20261126000100';
const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const before = dirs.filter((d) => d < FIRST_SCH1);
const sch1 = dirs.filter((d) => d >= FIRST_SCH1);
const sqlOf = (d: string) => readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8');

// Fixed ids (readable in assertions).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1);
const PLAN_S = id(10);
const PLAN_M = id(11);
const SUB_PENDING = id(20);
const SUB_SUSPENDED = id(21);
const SUB_CANCELLED = id(22);
const INV_FIRST = id(30);
const INV_RENEWAL = id(31);
const INV_PRORATA = id(32);
const INV_VOID = id(33);
const INV_MANUAL = id(34);
const PAY_WITH_FILE = id(40);
const PAY_NO_FILE = id(41);
const FILE_OLD = id(50);
const FILE_NEW = id(51);

const FIXTURES_BILLING = `
INSERT INTO plans (id, code, name, updated_at) VALUES
  ('${PLAN_S}', 'S', 'Plan S', now()), ('${PLAN_M}', 'M', 'Plan M', now());
INSERT INTO tenants (id, slug, name, country, timezone, updated_at)
  VALUES ('${T}', 'mig', 'Hôtel Mig', 'TG', 'Africa/Lome', now());
INSERT INTO subscriptions (id, tenant_id, plan_id, billing_cycle, status, price_snapshot, updated_at) VALUES
  ('${SUB_PENDING}', '${T}', '${PLAN_M}', 'MONTHLY', 'ACTIVE',
   '{"amount": "50000", "pendingChange": {"planId": "${PLAN_S}", "billingCycle": "YEARLY", "effectiveAt": "2026-12-18", "requestedBy": "u1"}}', now()),
  ('${SUB_SUSPENDED}', '${T}', '${PLAN_S}', 'MONTHLY', 'SUSPENDED', NULL, '2026-11-20T00:00:00Z'),
  ('${SUB_CANCELLED}', '${T}', '${PLAN_S}', 'MONTHLY', 'CANCELLED', NULL, '2026-11-21T00:00:00Z');
INSERT INTO subscription_events (id, subscription_id, from_status, to_status, created_at) VALUES
  (gen_random_uuid(), '${SUB_SUSPENDED}', 'ACTIVE', 'SUSPENDED', '2026-10-01T08:00:00Z'),
  (gen_random_uuid(), '${SUB_SUSPENDED}', 'SUSPENDED', 'ACTIVE', '2026-10-05T08:00:00Z'),
  (gen_random_uuid(), '${SUB_SUSPENDED}', 'ACTIVE', 'SUSPENDED', '2026-11-02T08:00:00Z'),
  (gen_random_uuid(), '${SUB_SUSPENDED}', 'SUSPENDED', 'SUSPENDED', '2026-11-03T08:00:00Z');
INSERT INTO platform_invoices (id, tenant_id, subscription_id, number, issue_date, due_date, period_start, period_end, subtotal, total, status, updated_at) VALUES
  ('${INV_FIRST}', '${T}', '${SUB_PENDING}', 'PLT-2026-000001', '2026-10-18', '2026-10-18', '2026-10-18', '2026-11-18', 25000, 25000, 'PAID', now()),
  ('${INV_RENEWAL}', '${T}', '${SUB_PENDING}', 'PLT-2026-000002', '2026-11-11', '2026-11-18', '2026-11-18', '2026-12-18', 25000, 25000, 'ISSUED', now()),
  ('${INV_PRORATA}', '${T}', '${SUB_PENDING}', 'PLT-2026-000003', '2026-11-20', '2026-11-27', '2026-11-20', '2026-12-18', 12500, 12500, 'ISSUED', now()),
  ('${INV_VOID}', '${T}', '${SUB_SUSPENDED}', 'PLT-2026-000004', '2026-11-01', '2026-11-08', '2026-11-01', '2026-12-01', 25000, 25000, 'VOID', '2026-11-05T10:00:00Z'),
  ('${INV_MANUAL}', '${T}', NULL, 'PLT-2026-000005', '2026-11-01', '2026-11-08', NULL, NULL, 1000, 1000, 'ISSUED', now());
INSERT INTO platform_invoice_lines (id, invoice_id, label, unit_amount, amount) VALUES
  (gen_random_uuid(), '${INV_PRORATA}', 'Prorata Plan S → Plan M (14/30 j)', 12500, 12500),
  (gen_random_uuid(), '${INV_RENEWAL}', 'Abonnement Plan S', 25000, 25000);
INSERT INTO outbox_events (id, tenant_id, type, payload, created_at) VALUES
  (gen_random_uuid(), '${T}', 'platform_invoice.voided', '{"invoiceId": "${INV_VOID}", "reason": "superseded"}', '2026-11-04T09:00:00Z');
INSERT INTO files (id, tenant_id, key, original_name, mime, size, created_at, updated_at) VALUES
  ('${FILE_OLD}', '${T}', 'k-old', 'REC-2026-000001.pdf', 'application/pdf', 1, '2026-11-01T00:00:00Z', now()),
  ('${FILE_NEW}', '${T}', 'k-new', 'REC-2026-000001.pdf', 'application/pdf', 1, '2026-11-02T00:00:00Z', now());
INSERT INTO payments (id, tenant_id, amount, method, paid_at, status, receipt_number, updated_at) VALUES
  ('${PAY_WITH_FILE}', '${T}', 25000, 'MIXX', '2026-11-01', 'CONFIRMED', 'REC-2026-000001', now()),
  ('${PAY_NO_FILE}', '${T}', 5000, 'CASH', '2026-11-01', 'CONFIRMED', 'REC-2026-000002', now());
`;

let pg: TestPostgres;
const q = (sql: string) => pg.psql(sql).then((s) => s.trim());

beforeAll(async () => {
  pg = await startTestPostgres({ database: 'hm_sch1', migrate: false });
  for (const d of before) await pg.psql(sqlOf(d));
  await pg.psql(FIXTURES_BILLING);
  for (const d of sch1) await pg.psql(sqlOf(d));
});
afterAll(async () => {
  await pg?.stop();
});

describe('SCH-1 group 1 — platform billing', () => {
  it('derives the invoice kind from the old prorata label / subscription order', async () => {
    const rows = await q(`SELECT number || ':' || kind FROM platform_invoices ORDER BY number`);
    expect(rows.split('\n')).toEqual([
      'PLT-2026-000001:SUBSCRIPTION',
      'PLT-2026-000002:RENEWAL',
      'PLT-2026-000003:PRORATA',
      'PLT-2026-000004:SUBSCRIPTION',
      'PLT-2026-000005:MANUAL',
    ]);
  });

  it('moves the void reason / date from the outbox event', async () => {
    expect(
      await q(
        `SELECT void_reason || '|' || voided_at FROM platform_invoices WHERE id = '${INV_VOID}'`,
      ),
    ).toBe('superseded|2026-11-04 09:00:00+00');
    expect(await q(`SELECT count(*) FROM platform_invoices WHERE voided_at IS NOT NULL`)).toBe('1');
  });

  it('links the latest receipt file, leaves payments without file empty', async () => {
    expect(
      await q(`SELECT coalesce(receipt_file_id::text, '-') FROM payments ORDER BY receipt_number`),
    ).toBe(`${FILE_NEW}\n-`);
  });

  it('moves price_snapshot.pendingChange into the pending_* columns', async () => {
    expect(
      await q(
        `SELECT pending_plan_id || '|' || pending_cycle || '|' || pending_effective_at || '|' || price_snapshot::text
           FROM subscriptions WHERE id = '${SUB_PENDING}'`,
      ),
    ).toBe(`${PLAN_S}|YEARLY|2026-12-18|{"amount": "50000"}`);
    expect(
      await q(`SELECT count(*) FROM subscriptions WHERE price_snapshot ? 'pendingChange'`),
    ).toBe('0');
  });

  it('backfills suspended_at / cancelled_at from the subscription events', async () => {
    expect(await q(`SELECT suspended_at FROM subscriptions WHERE id = '${SUB_SUSPENDED}'`)).toBe(
      '2026-11-02 08:00:00+00',
    );
    // No event: falls back to the last update.
    expect(await q(`SELECT cancelled_at FROM subscriptions WHERE id = '${SUB_CANCELLED}'`)).toBe(
      '2026-11-21 00:00:00+00',
    );
    expect(await q(`SELECT count(*) FROM subscriptions WHERE suspended_at IS NOT NULL`)).toBe('1');
  });

  it('enforces the new CHECK constraints and the receipt-file-once rule', async () => {
    await expect(
      q(`UPDATE platform_invoices SET status = 'VOID' WHERE id = '${INV_MANUAL}'`),
    ).rejects.toThrow(/platform_invoices_void_check/);
    await expect(
      q(`UPDATE subscriptions SET pending_cycle = NULL WHERE id = '${SUB_PENDING}'`),
    ).rejects.toThrow(/subscriptions_pending_change_check/);
    await expect(
      q(`UPDATE payments SET receipt_file_id = '${FILE_OLD}' WHERE id = '${PAY_WITH_FILE}'`),
    ).rejects.toThrow(/only be set once/);
    await q(`UPDATE payments SET receipt_file_id = '${FILE_OLD}' WHERE id = '${PAY_NO_FILE}'`);
    await expect(q(`UPDATE payments SET amount = 1 WHERE id = '${PAY_NO_FILE}'`)).rejects.toThrow(
      /may only change/,
    );
  });
});
