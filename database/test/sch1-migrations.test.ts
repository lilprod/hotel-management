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
const U_STAFF = id(60);
const U_SIGNUP = id(61);
const U_INVITED = id(62);
const P_AGENT = id(70);
const SESS_IMP = id(80);
const SESS_IMP_UNKNOWN = id(81);
const SESS_STD = id(82);
const T2 = id(2);
const BRANDING_T2 = id(90);
const PROP = id(100);
const RT_DBL = id(101);
const RT_STE = id(102);
const ROOM_DEL_POLICE = 'a0000103-0000-4000-8000-000000000103';
const ROOM_DEL_NONE = 'b0000104-0000-4000-8000-000000000104';
const ROOM_LIVE = 'c0000105-0000-4000-8000-000000000105';
const RP = id(106);
const GUEST = id(107);
const RES = id(108);
const RR = id(109);
const STAY = id(110);
const POLICE = id(111);

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

const FIXTURES_IAM = `
INSERT INTO users (id, tenant_id, email, name, password_hash, status, updated_at) VALUES
  ('${U_STAFF}', '${T}', 'staff@mig.test', 'Staff', '$argon2id$current', 'ACTIVE', now()),
  ('${U_SIGNUP}', '${T}', 'owner@mig.test', 'Owner', '$argon2id$owner', 'INVITED', now()),
  ('${U_INVITED}', '${T}', 'invited@mig.test', 'Invited', NULL, 'INVITED', now());
INSERT INTO settings (id, tenant_id, scope, scope_id, key, value, updated_at) VALUES
  (gen_random_uuid(), '${T}', 'USER', '${U_STAFF}', '_iam.password_history', '["h-newest", "h-older"]', '2026-11-10T00:00:00Z'),
  (gen_random_uuid(), '${T}', 'USER', '${U_STAFF}', '_iam.mfa_backup_codes', '["c1", "c2", "c3"]', now()),
  (gen_random_uuid(), '${T}', 'TENANT', '${T}', '_iam.perm_ver', '7', now()),
  (gen_random_uuid(), '${T}', 'TENANT', '${T}', 'branding.other', '"kept"', now());
INSERT INTO platform_users (id, email, password_hash, name, role, updated_at)
  VALUES ('${P_AGENT}', 'Agent@Platform.test', 'x', 'Agent', 'SUPPORT', now());
INSERT INTO platform_settings (id, key, value, updated_at) VALUES
  (gen_random_uuid(), '_platform_user.${P_AGENT}.password_history', '["p1"]', now()),
  (gen_random_uuid(), '_platform_user.${P_AGENT}.mfa_backup_codes', '["pc1", "pc2"]', now());
INSERT INTO sessions (id, tenant_id, user_id, refresh_hash, user_agent, expires_at, updated_at) VALUES
  ('${SESS_IMP}', '${T}', '${U_STAFF}', 'r1', '[impersonation] agent@platform.test', now() + interval '1 hour', now()),
  ('${SESS_IMP_UNKNOWN}', '${T}', '${U_STAFF}', 'r2', '[impersonation] gone@platform.test', now() + interval '1 hour', now()),
  ('${SESS_STD}', '${T}', '${U_STAFF}', 'r3', 'Mozilla/5.0', now() + interval '1 hour', now());
`;

const FIXTURES_BRANDING = `
INSERT INTO tenants (id, slug, name, country, timezone, updated_at)
  VALUES ('${T2}', 'mig2', 'Hôtel Mig 2', 'TG', 'Africa/Lome', now());
INSERT INTO branding (id, tenant_id, primary_color, updated_at) VALUES ('${BRANDING_T2}', '${T2}', '#112233', now());
INSERT INTO settings (id, tenant_id, scope, scope_id, key, value, updated_at) VALUES
  (gen_random_uuid(), '${T}', 'TENANT', '${T}', 'branding.legal',
   '{"legalForm": "SARL", "nif": "1001234567", "rccm": "TG-LFW-01", "taxRegime": "RSI", "address": "Bd du 13 Janvier, Lomé"}', now()),
  (gen_random_uuid(), '${T}', 'TENANT', '${T}', 'branding.public_profile',
   '{"languages": ["fr", "en"], "contact": {"phone": "+22890000000", "email": null, "address": null, "website": "https://mig.tg"}}', now()),
  (gen_random_uuid(), NULL, 'PLATFORM', NULL, 'branding.legal',
   '{"legalForm": null, "nif": null, "rccm": null, "taxRegime": "TPU", "address": null}', now());
`;

const FIXTURES_LODGING = `
INSERT INTO properties (id, tenant_id, name, country, timezone, business_date, updated_at)
  VALUES ('${PROP}', '${T}', 'Mig Lomé', 'TG', 'Africa/Lome', '2026-11-01', now());
INSERT INTO room_types (id, tenant_id, property_id, code, name, description, max_adults, base_occupancy, updated_at) VALUES
  ('${RT_DBL}', '${T}', '${PROP}', 'DBL', 'Double', NULL, 2, 2, now()),
  ('${RT_STE}', '${T}', '${PROP}', 'STE', 'Suite', 'Vue mer', 3, 2, now());
INSERT INTO rooms (id, tenant_id, property_id, room_type_id, number, deleted_at, updated_at) VALUES
  ('${ROOM_DEL_POLICE}', '${T}', '${PROP}', '${RT_DBL}', '${ROOM_DEL_POLICE.slice(0, 8)}~deleted', now(), now()),
  ('${ROOM_DEL_NONE}', '${T}', '${PROP}', '${RT_DBL}', '${ROOM_DEL_NONE.slice(0, 8)}~deleted', now(), now()),
  ('${ROOM_LIVE}', '${T}', '${PROP}', '${RT_DBL}', '104', NULL, now());
INSERT INTO rate_plans (id, tenant_id, property_id, code, name, updated_at) VALUES ('${RP}', '${T}', '${PROP}', 'BAR', 'BAR', now());
INSERT INTO guests (id, tenant_id, first_name, last_name, updated_at) VALUES ('${GUEST}', '${T}', 'Ama', 'Mensah', now());
INSERT INTO reservations (id, tenant_id, property_id, number, arrival, departure, updated_at)
  VALUES ('${RES}', '${T}', '${PROP}', 'R-1', '2026-11-01', '2026-11-03', now());
INSERT INTO reservation_rooms (id, tenant_id, property_id, reservation_id, room_type_id, room_id, rate_plan_id, arrival, departure, updated_at)
  VALUES ('${RR}', '${T}', '${PROP}', '${RES}', '${RT_DBL}', '${ROOM_DEL_POLICE}', '${RP}', '2026-11-01', '2026-11-03', now());
INSERT INTO stays (id, tenant_id, property_id, reservation_room_id, checked_in_at, updated_at)
  VALUES ('${STAY}', '${T}', '${PROP}', '${RR}', '2026-11-01T14:00:00Z', now());
INSERT INTO police_records (id, tenant_id, stay_id, guest_id, snapshot, updated_at) VALUES ('${POLICE}', '${T}', '${STAY}', '${GUEST}',
  '{"roomNumber": "104", "provenance": "Accra", "destination": "Kara", "purpose": "Affaires", "businessDate": "2026-11-01", "arrival": "2026-11-01", "departure": "2026-11-03"}', now());
INSERT INTO audit_logs (id, tenant_id, user_id, action, entity, entity_id, before, after, at) VALUES
  (gen_random_uuid(), '${T}', '${U_STAFF}', 'front_desk.room_change', 'stay', '${STAY}',
   '{"roomId": "${ROOM_DEL_POLICE}", "roomNumber": "104"}', '{"roomId": "${ROOM_LIVE}", "roomNumber": "104", "reason": "Clim en panne", "movedNights": 1}', '2026-11-02T09:00:00Z'),
  (gen_random_uuid(), '${T}', '${U_STAFF}', 'front_desk.extend', 'stay', '${STAY}', '{"departure": "2026-11-03"}', '{"departure": "2026-11-04"}', '2026-11-02T10:00:00Z'),
  (gen_random_uuid(), '${T}', NULL, 'front_desk.check_out.override', 'stay', '${STAY}', NULL,
   '{"overrideReason": "Accord du directeur", "blockers": ["BALANCE_DUE"], "balance": 5000}', '2026-11-04T11:00:00Z'),
  (gen_random_uuid(), '${T}', NULL, 'front_desk.check_in', 'stay', '${STAY}', NULL, '{}', '2026-11-01T14:00:00Z'),
  (gen_random_uuid(), '${T}', NULL, 'front_desk.extend', 'stay', '${id(999)}', NULL, '{"departure": "2026-11-09"}', now());
`;

let pg: TestPostgres;
const q = (sql: string) => pg.psql(sql).then((s) => s.trim());

beforeAll(async () => {
  pg = await startTestPostgres({ database: 'hm_sch1', migrate: false });
  for (const d of before) await pg.psql(sqlOf(d));
  await pg.psql(FIXTURES_BILLING + FIXTURES_IAM + FIXTURES_BRANDING + FIXTURES_LODGING);
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

describe('SCH-1 group 2 — IAM / auth', () => {
  it('moves the password history and backup codes out of settings', async () => {
    expect(
      await q(
        `SELECT hash FROM password_history WHERE user_id = '${U_STAFF}' ORDER BY created_at DESC`,
      ),
    ).toBe('h-newest\nh-older');
    expect(
      await q(
        `SELECT count(*) || ':' || count(used_at) FROM mfa_backup_codes WHERE user_id = '${U_STAFF}'`,
      ),
    ).toBe('3:0');
    expect(
      await q(`SELECT hash FROM platform_password_history WHERE platform_user_id = '${P_AGENT}'`),
    ).toBe('p1');
    expect(await q(`SELECT count(*) FROM platform_mfa_backup_codes`)).toBe('2');
    expect(await q(`SELECT string_agg(key, ',') FROM settings WHERE key LIKE '_iam.%'`)).toBe('');
    expect(
      await q(`SELECT count(*) FROM platform_settings WHERE key LIKE '_platform_user.%'`),
    ).toBe('0');
  });

  it('moves the permission version to tenants.perm_ver', async () => {
    expect(await q(`SELECT perm_ver FROM tenants WHERE id = '${T}'`)).toBe('7');
  });

  it('turns the user-agent prefix into kind + impersonated_by (unknown agent: revoked)', async () => {
    const rows = await q(
      `SELECT id || '|' || kind || '|' || coalesce(impersonated_by::text, '-') || '|' || coalesce(user_agent, '-') || '|' || (revoked_at IS NOT NULL)
         FROM sessions ORDER BY id`,
    );
    expect(rows.split('\n')).toEqual([
      `${SESS_IMP}|IMPERSONATION|${P_AGENT}|-|false`,
      `${SESS_IMP_UNKNOWN}|IMPERSONATION|-|-|true`,
      `${SESS_STD}|STANDARD|-|Mozilla/5.0|false`,
    ]);
    await expect(
      q(`UPDATE sessions SET impersonated_by = '${P_AGENT}' WHERE id = '${SESS_STD}'`),
    ).rejects.toThrow(/sessions_impersonation_check/);
  });

  it('self-signup owners (INVITED + password) become PENDING_VERIFICATION', async () => {
    expect(
      await q(`SELECT string_agg(email || ':' || status, ',' ORDER BY email) FROM users`),
    ).toBe('invited@mig.test:INVITED,owner@mig.test:PENDING_VERIFICATION,staff@mig.test:ACTIVE');
  });
});

describe('SCH-1 group 3 — branding legal identity / public profile', () => {
  it('creates the missing branding row and moves branding.legal / public_profile', async () => {
    expect(
      await q(
        `SELECT concat_ws('|', legal_form, tax_id, rccm, tax_regime, legal_address, array_to_string(public_languages, ','), public_contact::text)
           FROM branding WHERE tenant_id = '${T}'`,
      ),
    ).toBe(
      'SARL|1001234567|TG-LFW-01|RSI|Bd du 13 Janvier, Lomé|en,fr|{"phone": "+22890000000", "website": "https://mig.tg"}',
    );
  });

  it('falls back on the platform default, keeps the existing columns', async () => {
    expect(
      await q(
        `SELECT concat_ws('|', id, primary_color, coalesce(tax_id, '-'), tax_regime, array_to_string(public_languages, ','), coalesce(public_contact::text, '-'))
           FROM branding WHERE tenant_id = '${T2}'`,
      ),
    ).toBe(`${BRANDING_T2}|#112233|-|TPU|fr|-`);
    expect(
      await q(
        `SELECT count(*) FROM settings WHERE key IN ('branding.legal', 'branding.public_profile')`,
      ),
    ).toBe('0');
    expect(await q(`SELECT string_agg(key, ',') FROM settings`)).toBe('branding.other');
  });

  it('refuses an empty language list', async () => {
    await expect(
      q(`UPDATE branding SET public_languages = '{}' WHERE tenant_id = '${T}'`),
    ).rejects.toThrow(/branding_public_languages_check/);
  });
});

describe('SCH-1 group 4 — lodging', () => {
  it('backfills room type translations in the tenant default locale', async () => {
    expect(
      await q(
        `SELECT code || '|' || name_i18n::text || '|' || coalesce(description_i18n::text, '-') FROM room_types ORDER BY code`,
      ),
    ).toBe('DBL|{"fr": "Double"}|-\nSTE|{"fr": "Suite"}|{"fr": "Vue mer"}');
  });

  it('restores deleted room numbers from the police records where possible', async () => {
    expect(
      await q(
        `SELECT id || '|' || number || '|' || (deleted_at IS NOT NULL) FROM rooms ORDER BY id`,
      ),
    ).toBe(
      [
        `${ROOM_DEL_POLICE}|104|true`,
        `${ROOM_DEL_NONE}|${ROOM_DEL_NONE.slice(0, 8)}~deleted|true`,
        `${ROOM_LIVE}|104|false`,
      ].join('\n'),
    );
  });

  it('partial unique index: a deleted number can be re-created, two live ones cannot', async () => {
    await q(
      `INSERT INTO rooms (id, tenant_id, property_id, room_type_id, number, updated_at)
         VALUES (gen_random_uuid(), '${T}', '${PROP}', '${RT_DBL}', '${ROOM_DEL_NONE.slice(0, 8)}~deleted', now())`,
    );
    await expect(
      q(
        `INSERT INTO rooms (id, tenant_id, property_id, room_type_id, number, updated_at)
           VALUES (gen_random_uuid(), '${T}', '${PROP}', '${RT_DBL}', '104', now())`,
      ),
    ).rejects.toThrow(/rooms_number_active_key/);
  });

  it('rates get the stay restrictions with consistent defaults', async () => {
    await q(
      `INSERT INTO rates (id, tenant_id, rate_plan_id, room_type_id, price, updated_at)
         VALUES ('${id(120)}', '${T}', '${RP}', '${RT_DBL}', 20000, now())`,
    );
    expect(
      await q(
        `SELECT coalesce(max_stay::text, '-') || '|' || closed_to_arrival || '|' || closed_to_departure FROM rates`,
      ),
    ).toBe('-|false|false');
    await expect(
      q(`UPDATE rates SET min_stay = 3, max_stay = 2 WHERE id = '${id(120)}'`),
    ).rejects.toThrow(/rates_stay_check/);
  });
});

describe('SCH-1 group 5 — front desk', () => {
  it('fills police_records.property_id, business_date and the structured fields', async () => {
    expect(
      await q(
        `SELECT concat_ws('|', property_id, business_date, provenance, destination, purpose, snapshot->>'provenance')
           FROM police_records WHERE id = '${POLICE}'`,
      ),
    ).toBe(`${PROP}|2026-11-01|Accra|Kara|Affaires|Accra`);
  });

  it('moves the stay reasons from the audit trail into stay_events', async () => {
    const rows = await q(
      `SELECT concat_ws('|', type, coalesce(reason, '-'), coalesce(actor_id::text, '-'), at, payload->'after'->>'roomNumber')
         FROM stay_events WHERE stay_id = '${STAY}' ORDER BY at`,
    );
    expect(rows.split('\n')).toEqual([
      `ROOM_CHANGE|Clim en panne|${U_STAFF}|2026-11-02 09:00:00+00|104`,
      `EXTEND|-|${U_STAFF}|2026-11-02 10:00:00+00`,
      'CHECKOUT_OVERRIDE|Accord du directeur|-|2026-11-04 11:00:00+00',
    ]);
    // Audit rows of unknown stays and other actions are not copied.
    expect(await q(`SELECT count(*) FROM stay_events`)).toBe('3');
  });

  it('stay_events are append-only, police records immutable (signature set once)', async () => {
    await expect(q(`UPDATE stay_events SET reason = 'x'`)).rejects.toThrow(/append-only/);
    await expect(q(`DELETE FROM stay_events`)).rejects.toThrow(/append-only/);
    await expect(
      q(`UPDATE police_records SET purpose = 'Tourisme' WHERE id = '${POLICE}'`),
    ).rejects.toThrow(/may only add the signature/);
    await q(`UPDATE police_records SET signature_file_id = '${FILE_OLD}' WHERE id = '${POLICE}'`);
    await expect(
      q(`UPDATE police_records SET signature_file_id = '${FILE_NEW}' WHERE id = '${POLICE}'`),
    ).rejects.toThrow(/may only add the signature/);
    await expect(q(`DELETE FROM police_records`)).rejects.toThrow(/immutable/);
  });
});
