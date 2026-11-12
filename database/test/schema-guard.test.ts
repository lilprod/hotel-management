/**
 * Guards for future migrations: every table carrying tenant_id must have RLS enabled + forced
 * and a tenant policy, unless it is a platform table listed below (doc 04 §1, admin-only).
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAdminClient } from '../src/index.js';
import type { AdminClient } from '../src/index.js';

const PLATFORM_TABLES_WITH_TENANT_ID = new Set([
  'tenant_domains',
  'tenant_overrides',
  'subscriptions',
  'platform_invoices',
  'payments',
  'tenant_credits',
  'payment_declarations',
  'support_tickets',
  'tenant_addons',
  'coupon_redemptions',
]);
const CATALOG_READABLE = [
  'plans',
  'plan_prices',
  'plan_features',
  'plan_quotas',
  'addons',
  'addon_prices',
  'tax_rules',
  'legal_documents',
];

const { adminUrl } = inject('pg');
let admin: AdminClient;

beforeAll(() => {
  admin = createAdminClient({ url: adminUrl });
});
afterAll(async () => {
  await admin?.$disconnect();
});

describe('schema guard', () => {
  it('every tenant table has RLS enabled, forced and a tenant_isolation policy', async () => {
    const rows = await admin.$queryRaw<
      { table: string; rls: boolean; forced: boolean; policies: bigint }[]
    >`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
                AND p.policyname = 'tenant_isolation') AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'p')`;
    const tenantTables = rows.filter((r) => !PLATFORM_TABLES_WITH_TENANT_ID.has(r.table));
    expect(tenantTables.length).toBeGreaterThan(100);
    const unprotected = tenantTables
      .filter((r) => !r.rls || !r.forced || r.policies !== 1n)
      .map((r) => r.table);
    expect(unprotected).toEqual([]);
    // and platform tables are not reachable by hm_app at all
    const leaking = rows
      .filter((r) => PLATFORM_TABLES_WITH_TENANT_ID.has(r.table) && r.rls)
      .map((r) => r.table);
    expect(leaking).toEqual([]);
  });

  it('hm_app is NOBYPASSRLS and only reads the platform catalogue', async () => {
    const [role] = await admin.$queryRaw<{ bypass: boolean; superuser: boolean }[]>`
      SELECT rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname = 'hm_app'`;
    expect(role).toEqual({ bypass: false, superuser: false });

    const granted = await admin.$queryRaw<{ table: string }[]>`
      SELECT DISTINCT c.relname AS table
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND NOT c.relrowsecurity AND has_table_privilege('hm_app', c.oid, 'SELECT')`;
    expect(granted.map((g) => g.table).sort()).toEqual([...CATALOG_READABLE].sort());
  });

  it('hm_app cannot write append-only tables beyond INSERT', async () => {
    const rows = await admin.$queryRaw<{ t: string; upd: boolean; del: boolean }[]>`
      SELECT t, has_table_privilege('hm_app', t, 'UPDATE') AS upd, has_table_privilege('hm_app', t, 'DELETE') AS del
      FROM unnest(ARRAY['audit_logs', 'folio_lines', 'loyalty_transactions', 'stock_movements']) AS t`;
    expect(rows.every((r) => !r.upd && !r.del)).toBe(true);
  });
});
