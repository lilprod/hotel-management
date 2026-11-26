-- SCH-2 group 2 — folio & payments: real columns instead of workarounds.
--   * folios.kind / reservation_id / reservation_room_id (was: folio number "<reservation>-<room #>-<n>"
--     parsed to find the reservation room, "CL-" prefix for company accounts). One company account
--     per (company, property) is now a partial UNIQUE index (was: advisory lock).
--   * folio_lines.reason (was: embedded in the label "Contre-passation (<reason>) : …").
--   * folio_payments.business_date (was: paid_at time window), receipt_number gap-free per
--     property and year via `sequences` key `receipt` (was: derived from the payment id), partial
--     UNIQUE (tenant_id, method, reference) on live positive payments (was: advisory lock + lookup).
--   * cash_sessions.expected / counted JSONB per tender at close (was: read back from the audit
--     log), partial UNIQUE one open session per (tenant, property, user) (was: advisory lock).
-- Section 1 is Prisma's DDL, adapted to add the NOT NULL columns after their backfill.

-- ─────────────────────────── 1. DDL ───────────────────────────
-- CreateEnum
CREATE TYPE "folio_kind" AS ENUM ('STAY', 'GROUP', 'COMPANY', 'OTHER');

-- AlterTable
ALTER TABLE "cash_sessions" ADD COLUMN     "counted" JSONB,
ADD COLUMN     "expected" JSONB;

-- AlterTable
ALTER TABLE "folio_lines" ADD COLUMN     "reason" VARCHAR(200);

-- AlterTable (NOT NULL set in section 2 once filled)
ALTER TABLE "folio_payments" ADD COLUMN     "business_date" DATE,
ADD COLUMN     "receipt_number" VARCHAR(40);

-- AlterTable
ALTER TABLE "folios" ADD COLUMN     "kind" "folio_kind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "reservation_id" UUID,
ADD COLUMN     "reservation_room_id" UUID;

-- CreateIndex
CREATE INDEX "folio_payments_property_id_business_date_idx" ON "folio_payments"("property_id", "business_date");

-- CreateIndex
CREATE INDEX "folios_reservation_id_idx" ON "folios"("reservation_id");

-- CreateIndex
CREATE INDEX "folios_reservation_room_id_idx" ON "folios"("reservation_room_id");

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_reservation_room_id_fkey" FOREIGN KEY ("reservation_room_id") REFERENCES "reservation_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────── 2. Data migration ───────────────────────────
-- 2.1 Folio links. a) checked-in stay → its reservation room.
UPDATE "folios" f SET reservation_room_id = rr.id, reservation_id = rr.reservation_id
  FROM "stays" s JOIN "reservation_rooms" rr ON rr.id = s.reservation_room_id
 WHERE s.id = f.stay_id AND f.group_id IS NULL;
-- b) pre-arrival folio "<reservation number>-<room ordinal>-<n>" (ordinal = creation order).
UPDATE "folios" f SET reservation_room_id = x.rr_id, reservation_id = x.reservation_id
  FROM (SELECT f2.id AS folio_id, rr.id AS rr_id, rr.reservation_id
          FROM "folios" f2
          JOIN "reservations" r ON r.property_id = f2.property_id
           AND r.number = (regexp_match(f2.number, '^(.+)-(\d{1,3})-(\d{1,3})$'))[1]
          JOIN (SELECT id, reservation_id,
                       row_number() OVER (PARTITION BY reservation_id ORDER BY created_at, id) AS ordinal
                  FROM "reservation_rooms") rr
            ON rr.reservation_id = r.id AND rr.ordinal = (regexp_match(f2.number, '^(.+)-(\d{1,3})-(\d{1,3})$'))[2]::int
         WHERE f2.reservation_room_id IS NULL AND f2.stay_id IS NULL AND f2.group_id IS NULL
           AND f2.company_id IS NULL) x
 WHERE f.id = x.folio_id;
-- c) kind.
UPDATE "folios" SET kind = CASE
    WHEN group_id IS NOT NULL THEN 'GROUP'
    WHEN reservation_room_id IS NOT NULL THEN 'STAY'
    WHEN company_id IS NOT NULL AND stay_id IS NULL AND number LIKE 'CL-%' THEN 'COMPANY'
    ELSE 'OTHER' END::"folio_kind";

-- 2.2 Correction reasons, taken from the labels written by the previous versions.
ALTER TABLE "folio_lines" DISABLE TRIGGER folio_lines_append_only;
UPDATE "folio_lines" SET reason = left(COALESCE(
    (regexp_match(label, '^Contre-passation \((.+?)\) : '))[1],
    (regexp_match(label, '^Annulation \((.+?)\) : '))[1],
    (regexp_match(label, '^(Avoir \S+) : '))[1],
    (regexp_match(label, '^(Transfert vers \S+) : '))[1],
    'migrated'), 200)
 WHERE reversal_of_id IS NOT NULL;
UPDATE "folio_lines" SET reason = left(COALESCE((regexp_match(label, '^Remise sur .* : (.+)$'))[1], 'migrated'), 200)
 WHERE reversal_of_id IS NULL AND type = 'DISCOUNT' AND source_type = 'discount';
ALTER TABLE "folio_lines" ENABLE TRIGGER folio_lines_append_only;

-- 2.3 Payments: business date = day after the last night audit completed before the payment
-- (fallback: local date of the creation in the property time zone); receipt number in the order
-- of creation, per property and business year; the `receipt` sequences continue after them.
ALTER TABLE "folio_payments" DISABLE TRIGGER folio_payments_restrict_update;
UPDATE "folio_payments" p SET business_date = COALESCE(
    (SELECT max(na.business_date) + 1 FROM "night_audits" na
      WHERE na.property_id = p.property_id AND na.status = 'COMPLETED' AND na.completed_at <= p.created_at),
    (p.created_at AT TIME ZONE pr.timezone)::date)
  FROM "properties" pr
 WHERE pr.id = p.property_id;
UPDATE "folio_payments" p SET receipt_number = 'REC-' || x.y || '-' || lpad(x.rn::text, GREATEST(6, length(x.rn::text)), '0')
  FROM (SELECT id, extract(year FROM business_date)::int AS y,
               row_number() OVER (PARTITION BY property_id, extract(year FROM business_date) ORDER BY created_at, id) AS rn
          FROM "folio_payments") x
 WHERE x.id = p.id;
ALTER TABLE "folio_payments" ENABLE TRIGGER folio_payments_restrict_update;
INSERT INTO "sequences" (id, tenant_id, scope, key, year, next_value, updated_at)
SELECT gen_random_uuid(), tenant_id, tenant_id::text || ':' || property_id::text, 'receipt',
       extract(year FROM business_date)::int, count(*) + 1, now()
  FROM "folio_payments"
 GROUP BY tenant_id, property_id, extract(year FROM business_date)
ON CONFLICT (scope, key, year) DO UPDATE SET next_value = GREATEST("sequences".next_value, EXCLUDED.next_value);
ALTER TABLE "folio_payments" ALTER COLUMN "business_date" SET NOT NULL;
ALTER TABLE "folio_payments" ALTER COLUMN "receipt_number" SET NOT NULL;
CREATE UNIQUE INDEX "folio_payments_tenant_id_property_id_receipt_number_key" ON "folio_payments"("tenant_id", "property_id", "receipt_number");

-- 2.4 Cash sessions: counted / expected detail of the close, from the audit trail
-- (fallback: the cash row of the session currency).
UPDATE "cash_sessions" s SET
  counted = a.after->'counted',
  expected = COALESCE((SELECT jsonb_agg(jsonb_build_object('method', e->>'method', 'currency', e->>'currency',
                                                           'expected', (e->>'expected')::bigint) ORDER BY e->>'method', e->>'currency')
                         FROM jsonb_array_elements(a.after->'counted') e
                        WHERE (e->>'expected')::bigint <> 0 OR e->>'method' = 'CASH'), '[]'::jsonb)
  FROM (SELECT DISTINCT ON (entity_id) entity_id, after FROM "audit_logs"
         WHERE entity = 'cash_session' AND action = 'cash.session.close'
           AND jsonb_typeof(after->'counted') = 'array'
         ORDER BY entity_id, at DESC) a
 WHERE a.entity_id = s.id::text AND s.closed_at IS NOT NULL;
UPDATE "cash_sessions" SET
  counted = jsonb_build_array(jsonb_build_object('method', 'CASH', 'currency', currency,
              'expected', COALESCE(expected_amount, 0), 'counted', COALESCE(counted_amount, 0),
              'variance', COALESCE(variance, 0))),
  expected = jsonb_build_array(jsonb_build_object('method', 'CASH', 'currency', currency,
              'expected', COALESCE(expected_amount, 0)))
 WHERE closed_at IS NOT NULL AND counted IS NULL;

-- ─────────────────────────── 3. Integrity ───────────────────────────
ALTER TABLE "folios" ADD CONSTRAINT folios_kind_check CHECK (
  (reservation_id IS NULL) = (reservation_room_id IS NULL)
  AND (kind <> 'STAY' OR (reservation_room_id IS NOT NULL AND group_id IS NULL))
  AND (kind <> 'GROUP' OR group_id IS NOT NULL)
  AND (kind <> 'COMPANY' OR (company_id IS NOT NULL AND stay_id IS NULL AND group_id IS NULL AND reservation_room_id IS NULL)));
-- One city-ledger account per company and property (replaces the advisory lock).
CREATE UNIQUE INDEX folios_company_account_key ON "folios" (tenant_id, property_id, company_id) WHERE kind = 'COMPANY';

ALTER TABLE "folio_lines" ADD CONSTRAINT folio_lines_reason_check CHECK (
  (reversal_of_id IS NULL AND NOT (type = 'DISCOUNT' AND source_type = 'discount')) OR reason IS NOT NULL);

-- A (method, reference) pair is used once by a live payment (refunds and counter-payments are
-- negative and may repeat the original reference). Replaces the advisory lock + lookup.
CREATE UNIQUE INDEX folio_payments_method_reference_active_key ON "folio_payments" (tenant_id, method, reference)
  WHERE reference IS NOT NULL AND status <> 'REVERSED' AND amount > 0;

-- One open cash session per cashier and property (replaces the advisory lock).
CREATE UNIQUE INDEX cash_sessions_one_open_key ON "cash_sessions" (tenant_id, property_id, user_id) WHERE closed_at IS NULL;
ALTER TABLE "cash_sessions" ADD CONSTRAINT cash_sessions_close_detail_check CHECK (
  (closed_at IS NULL) = (counted IS NULL) AND (closed_at IS NULL) = (expected IS NULL)
  AND (counted IS NULL OR jsonb_typeof(counted) = 'array')
  AND (expected IS NULL OR jsonb_typeof(expected) = 'array'));
