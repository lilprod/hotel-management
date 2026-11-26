/**
 * SCH-2 data migrations: the workaround data written by earlier versions (`_sys` custom
 * fields, number-based folio links, flags in JSON payloads, night-audit summaries…) is moved into
 * the new columns / tables.
 *
 * A dedicated throwaway cluster is migrated up to the last pre-SCH-2 migration, filled with
 * fixtures in the old shape, then the SCH-2 migrations are applied with psql.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from './pg.js';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const FIRST_SCH2 = '20261127000100';
const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const before = dirs.filter((d) => d < FIRST_SCH2);
const sch2 = dirs.filter((d) => d >= FIRST_SCH2);
const sqlOf = (d: string) => readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1);
const PROP = id(100);
const RT_DBL = id(101);
const RT_STE = id(102);
const RP = id(106);
const GUEST = id(107);
const RES_CANCEL = id(200);
const RES_NOSHOW = id(201);
const RES_PLAIN = id(202);
const GROUP = id(210);
const HOLDER = id(211);
const MEMBER = id(212);
const WAIT = id(220);
const RES_WAIT = id(221);
const RR_A = id(230);
const RR_B = id(231);
const STAY_A = id(232);
const COMPANY = id(233);
const USER = id(234);
const F_STAY = id(240);
const F_PRE = id(241);
const F_CL = id(242);
const F_GROUP = id(243);
const F_OTHER = id(244);
const L_CHARGE = id(250);
const L_REV = id(251);
const L_DISC = id(252);
const L_MOVE = id(253);
const P_BEFORE = id(260);
const P_AFTER = id(261);
const P_NEXT = id(262);
const CS_CLOSED = id(270);
const CS_LEGACY = id(271);
const CS_OPEN = id(272);
const I_INTERIM = id(280);
const I_FINAL = id(281);
const I_CN = id(282);
const I_COMPANY = id(283);
const P_SETTLE = id(284);

const PENALTY = (kind: string, amount: number, computed: number, waived: boolean) =>
  JSON.stringify({
    kind,
    amount,
    computedAmount: computed,
    waived,
    currency: 'XOF',
    businessDate: '2026-11-10',
    lines: [
      {
        reservationRoomId: id(300),
        policyId: null,
        percent: 50,
        amount: computed,
        daysBefore: 3,
        tier: 0,
      },
    ],
  });

const FIXTURES_BASE = `
INSERT INTO tenants (id, slug, name, country, timezone, updated_at)
  VALUES ('${T}', 'mig', 'Hôtel Mig', 'TG', 'Africa/Lome', now());
INSERT INTO properties (id, tenant_id, name, country, timezone, business_date, updated_at)
  VALUES ('${PROP}', '${T}', 'Mig Lomé', 'TG', 'Africa/Lome', '2026-11-12', now());
INSERT INTO room_types (id, tenant_id, property_id, code, name, max_adults, base_occupancy, updated_at) VALUES
  ('${RT_DBL}', '${T}', '${PROP}', 'DBL', 'Double', 2, 2, now()),
  ('${RT_STE}', '${T}', '${PROP}', 'STE', 'Suite', 3, 2, now());
INSERT INTO rate_plans (id, tenant_id, property_id, code, name, updated_at) VALUES ('${RP}', '${T}', '${PROP}', 'BAR', 'BAR', now());
INSERT INTO guests (id, tenant_id, first_name, last_name, updated_at) VALUES ('${GUEST}', '${T}', 'Ama', 'Mensah', now());
`;

const FIXTURES_RESERVATIONS = `
INSERT INTO reservations (id, tenant_id, property_id, number, status, booker_guest_id, group_id, arrival, departure, custom_fields, created_at, updated_at) VALUES
  ('${RES_CANCEL}', '${T}', '${PROP}', 'R-1', 'CANCELLED', '${GUEST}', NULL, '2026-11-13', '2026-11-15',
   '{"vip": "oui", "_sys": {"penalty": ${PENALTY('CANCELLATION', 30000, 30000, false)}}}', now(), now()),
  ('${RES_NOSHOW}', '${T}', '${PROP}', 'R-2', 'NO_SHOW', '${GUEST}', NULL, '2026-11-10', '2026-11-11',
   '{"_sys": {"penalty": ${PENALTY('NO_SHOW', 0, 20000, true)}}}', now(), now()),
  ('${RES_PLAIN}', '${T}', '${PROP}', 'R-3', 'CONFIRMED', '${GUEST}', NULL, '2026-11-20', '2026-11-21', '{"vip": "non"}', now(), now());
INSERT INTO groups (id, tenant_id, property_id, name, created_at, updated_at) VALUES ('${GROUP}', '${T}', '${PROP}', 'Séminaire', '2026-11-01', now());
INSERT INTO reservations (id, tenant_id, property_id, number, status, booker_guest_id, group_id, arrival, departure, custom_fields, created_at, updated_at) VALUES
  ('${HOLDER}', '${T}', '${PROP}', 'R-4', 'CONFIRMED', NULL, '${GROUP}', '2026-12-01', '2026-12-03',
   '{"_sys": {"allotment": {"releaseDate": "2026-11-25"}}}', '2026-11-01T10:00:00Z', now()),
  ('${MEMBER}', '${T}', '${PROP}', 'R-5', 'CONFIRMED', '${GUEST}', '${GROUP}', '2026-12-01', '2026-12-03', '{}', '2026-11-02T10:00:00Z', now()),
  ('${RES_WAIT}', '${T}', '${PROP}', 'R-6', 'CONFIRMED', '${GUEST}', NULL, '2026-12-05', '2026-12-06',
   '{"_sys": {"waitlistEntryId": "${WAIT}"}}', now(), now());
INSERT INTO reservation_rooms (id, tenant_id, property_id, reservation_id, room_type_id, rate_plan_id, arrival, departure, status, updated_at) VALUES
  (gen_random_uuid(), '${T}', '${PROP}', '${HOLDER}', '${RT_DBL}', '${RP}', '2026-12-01', '2026-12-03', 'CONFIRMED', now()),
  (gen_random_uuid(), '${T}', '${PROP}', '${HOLDER}', '${RT_DBL}', '${RP}', '2026-12-01', '2026-12-03', 'CANCELLED', now()),
  (gen_random_uuid(), '${T}', '${PROP}', '${HOLDER}', '${RT_STE}', '${RP}', '2026-12-01', '2026-12-03', 'CONFIRMED', now()),
  (gen_random_uuid(), '${T}', '${PROP}', '${MEMBER}', '${RT_DBL}', '${RP}', '2026-12-01', '2026-12-03', 'CONFIRMED', now());
INSERT INTO waitlist_entries (id, tenant_id, property_id, guest_id, room_type_id, arrival, departure, status, updated_at)
  VALUES ('${WAIT}', '${T}', '${PROP}', '${GUEST}', '${RT_DBL}', '2026-12-05', '2026-12-06', 'ACCEPTED', now());
`;

const FIXTURES_FOLIO = `
INSERT INTO users (id, tenant_id, email, name, status, updated_at) VALUES ('${USER}', '${T}', 'cash@mig.test', 'Caissier', 'ACTIVE', now());
INSERT INTO companies (id, tenant_id, name, updated_at) VALUES ('${COMPANY}', '${T}', 'ACME', now());
INSERT INTO reservation_rooms (id, tenant_id, property_id, reservation_id, room_type_id, rate_plan_id, arrival, departure, status, created_at, updated_at) VALUES
  ('${RR_A}', '${T}', '${PROP}', '${RES_PLAIN}', '${RT_DBL}', '${RP}', '2026-11-20', '2026-11-21', 'CHECKED_IN', '2026-11-01T10:00:00Z', now()),
  ('${RR_B}', '${T}', '${PROP}', '${RES_PLAIN}', '${RT_DBL}', '${RP}', '2026-11-20', '2026-11-21', 'CONFIRMED', '2026-11-01T10:00:01Z', now());
INSERT INTO stays (id, tenant_id, property_id, reservation_room_id, checked_in_at, updated_at)
  VALUES ('${STAY_A}', '${T}', '${PROP}', '${RR_A}', '2026-11-20T14:00:00Z', now());
INSERT INTO folios (id, tenant_id, property_id, stay_id, group_id, company_id, number, updated_at) VALUES
  ('${F_STAY}', '${T}', '${PROP}', '${STAY_A}', NULL, NULL, 'R-3-1-1', now()),
  ('${F_PRE}', '${T}', '${PROP}', NULL, NULL, NULL, 'R-3-2-1', now()),
  ('${F_CL}', '${T}', '${PROP}', NULL, NULL, '${COMPANY}', 'CL-000001', now()),
  ('${F_GROUP}', '${T}', '${PROP}', NULL, '${GROUP}', NULL, 'FO-2026-000001', now()),
  ('${F_OTHER}', '${T}', '${PROP}', NULL, NULL, NULL, 'FO-2026-000002', now());
INSERT INTO folio_lines (id, tenant_id, property_id, folio_id, business_date, type, label, unit_amount, amount, source_type, source_id, reversal_of_id) VALUES
  ('${L_CHARGE}', '${T}', '${PROP}', '${F_STAY}', '2026-11-10', 'ROOM', 'Nuitée', 20000, 20000, NULL, NULL, NULL),
  ('${L_REV}', '${T}', '${PROP}', '${F_STAY}', '2026-11-10', 'ROOM', 'Contre-passation (Erreur de chambre) : Nuitée', -20000, -20000, NULL, NULL, '${L_CHARGE}'),
  ('${L_DISC}', '${T}', '${PROP}', '${F_STAY}', '2026-11-10', 'DISCOUNT', 'Remise sur Nuitée : Client fidèle', -1000, -1000, 'discount', '${L_CHARGE}', NULL),
  ('${L_MOVE}', '${T}', '${PROP}', '${F_STAY}', '2026-11-10', 'DISCOUNT', 'Transfert vers FO-2026-000002 : Remise sur Nuitée : Client fidèle', 1000, 1000, 'discount', '${L_CHARGE}', '${L_DISC}');
INSERT INTO night_audits (id, tenant_id, property_id, business_date, status, completed_at, summary, updated_at) VALUES
  (gen_random_uuid(), '${T}', '${PROP}', '2026-11-10', 'COMPLETED', '2026-11-11T02:00:00Z', '{"locked": true}', now());
INSERT INTO folio_payments (id, tenant_id, property_id, folio_id, amount, method, reference, created_at, updated_at) VALUES
  ('${P_BEFORE}', '${T}', '${PROP}', '${F_STAY}', 5000, 'MIXX', 'MX-1', '2026-11-11T01:30:00Z', now()),
  ('${P_AFTER}', '${T}', '${PROP}', '${F_STAY}', 5000, 'CASH', NULL, '2026-11-11T03:00:00Z', now()),
  ('${P_NEXT}', '${T}', '${PROP}', '${F_PRE}', 2000, 'CARD', NULL, '2026-11-11T04:00:00Z', now());
INSERT INTO cash_sessions (id, tenant_id, property_id, user_id, currency, closed_at, expected_amount, counted_amount, variance, updated_at) VALUES
  ('${CS_CLOSED}', '${T}', '${PROP}', '${USER}', 'XOF', '2026-11-10T20:00:00Z', 15000, 14900, -100, now()),
  ('${CS_LEGACY}', '${T}', '${PROP}', '${USER}', 'XOF', '2026-11-09T20:00:00Z', 1000, 1000, 0, now()),
  ('${CS_OPEN}', '${T}', '${PROP}', '${USER}', 'XOF', NULL, NULL, NULL, NULL, now());
INSERT INTO audit_logs (id, tenant_id, user_id, action, entity, entity_id, after, at) VALUES
  (gen_random_uuid(), '${T}', '${USER}', 'cash.session.close', 'cash_session', '${CS_CLOSED}',
   '{"counted": [{"method": "CARD", "currency": "XOF", "expected": 2000, "counted": 2000, "variance": 0},
                 {"method": "CASH", "currency": "XOF", "expected": 15000, "counted": 14900, "variance": -100}]}', '2026-11-10T20:00:00Z');
`;

const FIXTURES_INVOICING = `
INSERT INTO invoices (id, tenant_id, property_id, folio_id, credit_note_of_id, number, issue_date, customer_snapshot, subtotal, tax_total, total, totals, status, updated_at) VALUES
  ('${I_INTERIM}', '${T}', '${PROP}', '${F_STAY}', NULL, 'FA-1', '2026-11-10', '{}', 20000, 0, 20000,
   '{"interim": true, "payments": [{"method": "CASH", "amount": 20000}]}', 'PAID', now()),
  ('${I_FINAL}', '${T}', '${PROP}', '${F_PRE}', NULL, 'FA-2', '2026-11-11', '{}', 30000, 0, 30000,
   '{"payments": [{"method": "CITY_LEDGER", "amount": 25000}, {"method": "CARD", "amount": 5000}]}', 'ISSUED', now()),
  ('${I_CN}', '${T}', '${PROP}', '${F_STAY}', '${I_INTERIM}', 'AV-1', '2026-11-11', '{}', -1000, 0, -1000, '{"payments": []}', 'ISSUED', now()),
  ('${I_COMPANY}', '${T}', '${PROP}', '${F_CL}', NULL, 'FA-3', '2026-11-11', '{}', 5000, 0, 5000, '{"payments": [{"method": "BANK_TRANSFER", "amount": 5000}]}', 'PAID', now());
INSERT INTO fiscal_documents (id, tenant_id, invoice_id, provider, status, payload, updated_at) VALUES
  (gen_random_uuid(), '${T}', '${I_INTERIM}', 'none', 'ACCEPTED', '{"skipped": true, "reason": "NOT_APPLICABLE"}', now()),
  (gen_random_uuid(), '${T}', '${I_FINAL}', 'emecef', 'ACCEPTED', '{"result": "ACCEPTED"}', now());
INSERT INTO folio_payments (id, tenant_id, property_id, folio_id, amount, method, reference, created_at, updated_at)
  VALUES ('${P_SETTLE}', '${T}', '${PROP}', '${F_CL}', 30000, 'BANK_TRANSFER', 'VIR-1', '2026-11-12T10:00:00Z', now());
`;

const KPIS = JSON.stringify({
  businessDate: '2026-11-11',
  currency: 'XOF',
  roomsAvailable: 4,
  roomsSold: 2,
  roomRevenue: 70000,
  totalRevenue: 73000,
  adr: 35000,
  revpar: 17500,
  revenueByDept: { ROOM: 70000, MINIBAR: 3000 },
  taxes: [
    { code: 'TVA18', name: 'TVA 18 %', kind: 'VAT', amount: 12600 },
    { code: 'TS', name: 'Taxe de séjour', kind: 'TOURIST', amount: 3000 },
  ],
  vatTotal: 12600,
  touristTaxTotal: 3000,
  payments: [{ method: 'CARD', amount: 20000 }],
  paymentsTotal: 20000,
  arrivals: 2,
  departures: 1,
  inHouse: 3,
  noShows: 1,
});
const FIXTURES_NIGHT_AUDIT = `
INSERT INTO night_audits (id, tenant_id, property_id, business_date, status, completed_at, summary, updated_at) VALUES
  (gen_random_uuid(), '${T}', '${PROP}', '2026-11-11', 'COMPLETED', '2026-11-12T02:00:00Z',
   '{"trigger": "auto", "steps": {}, "locked": true, "lockedAt": "2026-11-12T01:59:00Z", "kpis": ${KPIS}}', now());
`;

const U_OWNER = id(290);
const U_VERIFIED = id(291);
const U_STAFF = id(292);
const U_INV = id(293);
const FIXTURES_USERS = `
INSERT INTO users (id, tenant_id, email, name, password_hash, status, last_login_at, updated_at) VALUES
  ('${U_OWNER}', '${T}', 'owner@mig.test', 'Owner', '$argon2id$x', 'DISABLED', NULL, now()),
  ('${U_VERIFIED}', '${T}', 'verified@mig.test', 'Verified', '$argon2id$x', 'DISABLED', NULL, now()),
  ('${U_STAFF}', '${T}', 'staff@mig.test', 'Staff', '$argon2id$x', 'DISABLED', now(), now()),
  ('${U_INV}', '${T}', 'inv@mig.test', 'Inv', NULL, 'DISABLED', NULL, now());
INSERT INTO audit_logs (id, tenant_id, user_id, action, entity, entity_id, before, at) VALUES
  (gen_random_uuid(), '${T}', '${U_OWNER}', 'tenant.signup', 'tenant', '${T}', NULL, '2026-11-01T00:00:00Z'),
  (gen_random_uuid(), '${T}', '${U_VERIFIED}', 'tenant.signup', 'tenant', '${T}', NULL, '2026-11-01T00:00:00Z'),
  (gen_random_uuid(), '${T}', '${U_VERIFIED}', 'tenant.owner_email_verified', 'user', '${U_VERIFIED}', NULL, '2026-11-01T01:00:00Z'),
  (gen_random_uuid(), '${T}', NULL, 'iam.user_deactivated', 'user', '${U_STAFF}', '{"status": "ACTIVE"}', '2026-11-05T00:00:00Z');
`;

let pg: TestPostgres;
const q = (sql: string) => pg.psql(sql).then((s) => s.trim());

beforeAll(async () => {
  pg = await startTestPostgres({ database: 'hm_sch2', migrate: false });
  for (const d of before) await pg.psql(sqlOf(d));
  await pg.psql(
    FIXTURES_BASE +
      FIXTURES_RESERVATIONS +
      FIXTURES_FOLIO +
      FIXTURES_INVOICING +
      FIXTURES_NIGHT_AUDIT +
      FIXTURES_USERS,
  );
  for (const d of sch2) await pg.psql(sqlOf(d));
});
afterAll(async () => {
  await pg?.stop();
});

describe('SCH-2 group 1 — reservations', () => {
  it('moves _sys.penalty into the penalty_* columns and cleans the custom fields', async () => {
    const rows = await q(
      `SELECT concat_ws('|', number, coalesce(penalty_kind::text, '-'), coalesce(penalty_amount::text, '-'),
                        coalesce(penalty_computed_amount::text, '-'), penalty_waived, coalesce(penalty_business_date::text, '-'),
                        coalesce(jsonb_array_length(penalty_lines)::text, '-'), custom_fields::text)
         FROM reservations WHERE number IN ('R-1', 'R-2', 'R-3') ORDER BY number`,
    );
    expect(rows.split('\n')).toEqual([
      'R-1|CANCELLATION|30000|30000|f|2026-11-10|1|{"vip": "oui"}',
      'R-2|NO_SHOW|0|20000|t|2026-11-10|1|{}',
      'R-3|-|-|-|f|-|-|{"vip": "non"}',
    ]);
    expect(await q(`SELECT count(*) FROM reservations WHERE custom_fields ? '_sys'`)).toBe('0');
  });

  it('links the allotment holder, release date and contracted block of the group', async () => {
    expect(
      await q(
        `SELECT allotment_reservation_id || '|' || release_date FROM groups WHERE id = '${GROUP}'`,
      ),
    ).toBe(`${HOLDER}|2026-11-25`);
    // DBL: 2 holder lines (held + released) + 1 picked up; STE: 1 held.
    expect(
      await q(
        `SELECT string_agg(rt.code || ':' || b.rooms, ',' ORDER BY rt.code) FROM group_blocks b
           JOIN room_types rt ON rt.id = b.room_type_id WHERE b.group_id = '${GROUP}'`,
      ),
    ).toBe('DBL:3,STE:1');
  });

  it('links the waitlist entry to the reservation created on acceptance', async () => {
    expect(await q(`SELECT reservation_id FROM waitlist_entries WHERE id = '${WAIT}'`)).toBe(
      RES_WAIT,
    );
  });

  it('enforces the penalty consistency and refuses a `_sys` custom field', async () => {
    await expect(
      q(`UPDATE reservations SET penalty_amount = NULL WHERE id = '${RES_CANCEL}'`),
    ).rejects.toThrow(/reservations_penalty_check/);
    await expect(
      q(`UPDATE reservations SET penalty_waived = true WHERE id = '${RES_CANCEL}'`),
    ).rejects.toThrow(/reservations_penalty_check/);
    await expect(
      q(`UPDATE reservations SET custom_fields = '{"_sys": {}}' WHERE id = '${RES_PLAIN}'`),
    ).rejects.toThrow(/reservations_custom_fields_check/);
    await expect(
      q(`UPDATE group_blocks SET rooms = 0 WHERE group_id = '${GROUP}'`),
    ).rejects.toThrow(/group_blocks_rooms_check/);
  });

  it('group_blocks is tenant-isolated (RLS forced, policy)', async () => {
    expect(
      await q(
        `SELECT relrowsecurity || '|' || relforcerowsecurity || '|' ||
                (SELECT count(*) FROM pg_policies WHERE tablename = 'group_blocks' AND policyname = 'tenant_isolation')
           FROM pg_class WHERE relname = 'group_blocks'`,
      ),
    ).toBe('true|true|1');
  });
});

describe('SCH-2 group 2 — folio & payments', () => {
  it('links folios by columns (stay, pre-arrival number, company, group) with their kind', async () => {
    const rows = await q(
      `SELECT number || '|' || kind || '|' || coalesce(reservation_room_id::text, '-') FROM folios ORDER BY number`,
    );
    expect(rows.split('\n')).toEqual([
      'CL-000001|COMPANY|-',
      'FO-2026-000001|GROUP|-',
      'FO-2026-000002|OTHER|-',
      `R-3-1-1|STAY|${RR_A}`,
      `R-3-2-1|STAY|${RR_B}`,
    ]);
    expect(
      await q(
        `SELECT count(*) FROM folios WHERE kind = 'STAY' AND reservation_id = '${RES_PLAIN}'`,
      ),
    ).toBe('2');
  });

  it('extracts the correction reasons from the labels', async () => {
    const rows = await q(`SELECT id || '|' || coalesce(reason, '-') FROM folio_lines ORDER BY id`);
    expect(rows.split('\n')).toEqual([
      `${L_CHARGE}|-`,
      `${L_REV}|Erreur de chambre`,
      `${L_DISC}|Client fidèle`,
      `${L_MOVE}|Transfert vers FO-2026-000002`,
    ]);
    await expect(
      q(`INSERT INTO folio_lines (id, tenant_id, property_id, folio_id, business_date, type, label, unit_amount, amount, reversal_of_id)
           VALUES (gen_random_uuid(), '${T}', '${PROP}', '${F_STAY}', '2026-11-12', 'ROOM', 'x', 1, 1, '${L_MOVE}')`),
    ).rejects.toThrow(/folio_lines_reason_check/);
  });

  it('backfills business dates (night audit aware) and gap-free receipt numbers, continues the sequence', async () => {
    const rows = await q(
      `SELECT id || '|' || business_date || '|' || receipt_number FROM folio_payments ORDER BY created_at`,
    );
    // 01:30 UTC = 01:30 in Lomé: the 2026-11-10 audit was not completed yet → still the 10th.
    expect(rows.split('\n')).toEqual([
      `${P_BEFORE}|2026-11-10|REC-2026-000001`,
      `${P_AFTER}|2026-11-11|REC-2026-000002`,
      `${P_NEXT}|2026-11-11|REC-2026-000003`,
      `${P_SETTLE}|2026-11-12|REC-2026-000004`,
    ]);
    expect(
      await q(
        `SELECT next_value FROM sequences WHERE scope = '${T}:${PROP}' AND key = 'receipt' AND year = 2026`,
      ),
    ).toBe('5');
  });

  it('a live (method, reference) is unique by index', async () => {
    await expect(
      q(`INSERT INTO folio_payments (id, tenant_id, property_id, folio_id, amount, method, reference, business_date, receipt_number, updated_at)
           VALUES (gen_random_uuid(), '${T}', '${PROP}', '${F_PRE}', 100, 'MIXX', 'MX-1', '2026-11-12', 'REC-2026-000099', now())`),
    ).rejects.toThrow(/folio_payments_method_reference_active_key/);
  });

  it('moves the close detail of the cash sessions into expected / counted', async () => {
    expect(await q(`SELECT counted::text FROM cash_sessions WHERE id = '${CS_CLOSED}'`)).toContain(
      '"variance": -100',
    );
    expect(await q(`SELECT expected::text FROM cash_sessions WHERE id = '${CS_CLOSED}'`)).toBe(
      '[{"method": "CARD", "currency": "XOF", "expected": 2000}, {"method": "CASH", "currency": "XOF", "expected": 15000}]',
    );
    expect(await q(`SELECT expected::text FROM cash_sessions WHERE id = '${CS_LEGACY}'`)).toBe(
      '[{"method": "CASH", "currency": "XOF", "expected": 1000}]',
    );
    expect(
      await q(`SELECT coalesce(counted::text, '-') FROM cash_sessions WHERE id = '${CS_OPEN}'`),
    ).toBe('-');
    await expect(
      q(`INSERT INTO cash_sessions (id, tenant_id, property_id, user_id, updated_at)
           VALUES (gen_random_uuid(), '${T}', '${PROP}', '${USER}', now())`),
    ).rejects.toThrow(/cash_sessions_one_open_key/);
  });
});

describe('SCH-2 group 3 — invoicing', () => {
  it('derives the invoice kind and the amount payable through the city ledger', async () => {
    const rows = await q(
      `SELECT number || '|' || kind || '|' || ledger_amount || '|' || status FROM invoices ORDER BY number`,
    );
    expect(rows.split('\n')).toEqual([
      'AV-1|CREDIT_NOTE|0|ISSUED',
      'FA-1|INTERIM|0|PAID',
      'FA-2|FINAL|25000|ISSUED',
      'FA-3|COMPANY|0|PAID',
    ]);
  });

  it('turns "ACCEPTED + skipped" fiscal documents into SKIPPED', async () => {
    const rows = await q(
      `SELECT status || '|' || payload::text FROM fiscal_documents ORDER BY status`,
    );
    expect(rows.split('\n')).toEqual([
      'ACCEPTED|{"result": "ACCEPTED"}',
      'SKIPPED|{"reason": "NOT_APPLICABLE"}',
    ]);
  });

  it('a ledger allocation makes the invoice PARTIALLY_PAID then PAID; over-allocation and mutation refused', async () => {
    const alloc = (amount: number) =>
      q(`INSERT INTO ledger_allocations (id, tenant_id, settlement_id, invoice_id, amount)
           VALUES (gen_random_uuid(), '${T}', '${P_SETTLE}', '${I_FINAL}', ${amount})`);
    await expect(q(`UPDATE invoices SET status = 'PAID' WHERE id = '${I_FINAL}'`)).rejects.toThrow(
      /does not match its city-ledger allocations/,
    );
    await alloc(10000);
    await q(`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE id = '${I_FINAL}'`);
    await expect(alloc(20000)).rejects.toThrow(/exceed the amount payable/);
    await alloc(15000);
    await q(`UPDATE invoices SET status = 'PAID' WHERE id = '${I_FINAL}'`);
    // The settlement (30 000) has 5 000 left, no other invoice owes anything to the city ledger.
    await expect(
      q(`INSERT INTO ledger_allocations (id, tenant_id, settlement_id, invoice_id, amount)
           VALUES (gen_random_uuid(), '${T}', '${P_SETTLE}', '${I_COMPANY}', 1000)`),
    ).rejects.toThrow(/nothing payable/);
    await expect(q(`UPDATE ledger_allocations SET amount = 1`)).rejects.toThrow(/append-only/);
    await expect(q(`UPDATE invoices SET kind = 'FINAL' WHERE id = '${I_CN}'`)).rejects.toThrow(
      /may only change/,
    );
    expect(
      await q(
        `SELECT relrowsecurity || '|' || relforcerowsecurity FROM pg_class WHERE relname = 'ledger_allocations'`,
      ),
    ).toBe('true|true');
  });
});

describe('SCH-2 group 4 — night audit', () => {
  it('backfills locked_at and properties.closed_through_date, cleans the summary', async () => {
    expect(
      await q(
        `SELECT string_agg(business_date || '|' || locked_at, ',' ORDER BY business_date) FROM night_audits`,
      ),
    ).toBe('2026-11-10|2026-11-11 02:00:00+00,2026-11-11|2026-11-12 01:59:00+00');
    expect(await q(`SELECT closed_through_date FROM properties WHERE id = '${PROP}'`)).toBe(
      '2026-11-11',
    );
    expect(
      await q(
        `SELECT count(*) FROM night_audits WHERE summary ?| ARRAY['kpis', 'locked', 'lockedAt']`,
      ),
    ).toBe('0');
    expect(
      await q(`SELECT summary->>'trigger' FROM night_audits WHERE business_date = '2026-11-11'`),
    ).toBe('auto');
  });

  it('moves the summary KPIs into daily_stats_property columns', async () => {
    expect(
      await q(
        `SELECT concat_ws('|', occupied, available, revenue_room, revenue_total, vat_total, tourist_tax_total,
                          payments_total, arrivals, departures, in_house, no_shows, jsonb_array_length(taxes), payments_by_method::text)
           FROM daily_stats_property WHERE business_date = '2026-11-11'`,
      ),
    ).toBe('2|4|70000|73000|12600|3000|20000|2|1|3|1|2|[{"amount": 20000, "method": "CARD"}]');
  });

  it('refuses postings and payments dated in a closed day (closed_through_date guard)', async () => {
    await expect(
      q(`INSERT INTO folio_lines (id, tenant_id, property_id, folio_id, business_date, type, label, unit_amount, amount)
           VALUES (gen_random_uuid(), '${T}', '${PROP}', '${F_STAY}', '2026-11-11', 'EXTRA', 'Tardif', 1, 1)`),
    ).rejects.toThrow(/is closed/);
    await expect(
      q(`INSERT INTO folio_payments (id, tenant_id, property_id, folio_id, amount, method, business_date, receipt_number, updated_at)
           VALUES (gen_random_uuid(), '${T}', '${PROP}', '${F_STAY}', 1, 'CASH', '2026-11-10', 'REC-X', now())`),
    ).rejects.toThrow(/is closed/);
    await q(`INSERT INTO folio_lines (id, tenant_id, property_id, folio_id, business_date, type, label, unit_amount, amount)
               VALUES (gen_random_uuid(), '${T}', '${PROP}', '${F_STAY}', '2026-11-12', 'EXTRA', 'Ouvert', 1, 1)`);
  });
});

describe('SCH-2 group 5 — disabled users keep their previous status', () => {
  it('restores PENDING_VERIFICATION for a never-verified self-signup owner', async () => {
    const rows = await q(
      `SELECT email || '|' || status || '|' || coalesce(disabled_from_status::text, '-') FROM users
        WHERE id IN ('${U_OWNER}', '${U_VERIFIED}', '${U_STAFF}', '${U_INV}', '${USER}') ORDER BY email`,
    );
    expect(rows.split('\n')).toEqual([
      'cash@mig.test|ACTIVE|-',
      'inv@mig.test|DISABLED|INVITED',
      'owner@mig.test|DISABLED|PENDING_VERIFICATION',
      'staff@mig.test|DISABLED|ACTIVE',
      'verified@mig.test|DISABLED|ACTIVE',
    ]);
    await expect(
      q(`UPDATE users SET disabled_from_status = 'ACTIVE' WHERE id = '${USER}'`),
    ).rejects.toThrow(/users_disabled_from_status_check/);
  });
});
