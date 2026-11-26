-- SCH-2 group 1 — reservations: real columns instead of `reservations.custom_fields._sys`.
--   * reservations.penalty_* (was: _sys.penalty): kind, amount charged, computed amount, currency,
--     waiver, business date and per-line detail (penalty_lines JSONB).
--   * groups.allotment_reservation_id (was: "first reservation of the group without booker"),
--     groups.release_date (was: _sys.allotment.releaseDate), group_blocks (contracted block per
--     room type; the held lines stay on the allotment reservation).
--   * waitlist_entries.reservation_id (was: _sys.waitlistEntryId on the reservation).
-- Section 1 is Prisma's DDL; sections 2+ are hand-written.

-- ─────────────────────────── 1. DDL (prisma migrate diff) ───────────────────────────
-- CreateEnum
CREATE TYPE "penalty_kind" AS ENUM ('CANCELLATION', 'NO_SHOW');

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "allotment_reservation_id" UUID,
ADD COLUMN     "release_date" DATE;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "penalty_amount" BIGINT,
ADD COLUMN     "penalty_business_date" DATE,
ADD COLUMN     "penalty_computed_amount" BIGINT,
ADD COLUMN     "penalty_currency" CHAR(3),
ADD COLUMN     "penalty_kind" "penalty_kind",
ADD COLUMN     "penalty_lines" JSONB,
ADD COLUMN     "penalty_waived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "waitlist_entries" ADD COLUMN     "reservation_id" UUID;

-- CreateTable
CREATE TABLE "group_blocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "rooms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_blocks_tenant_id_idx" ON "group_blocks"("tenant_id");

-- CreateIndex
CREATE INDEX "group_blocks_room_type_id_idx" ON "group_blocks"("room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_blocks_group_id_room_type_id_key" ON "group_blocks"("group_id", "room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_allotment_reservation_id_key" ON "groups"("allotment_reservation_id");

-- CreateIndex
CREATE INDEX "groups_release_date_idx" ON "groups"("release_date");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_reservation_id_key" ON "waitlist_entries"("reservation_id");

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_allotment_reservation_id_fkey" FOREIGN KEY ("allotment_reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_blocks" ADD CONSTRAINT "group_blocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_blocks" ADD CONSTRAINT "group_blocks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_blocks" ADD CONSTRAINT "group_blocks_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────── 2. Data migration ───────────────────────────
-- 2.1 Penalty: _sys.penalty → columns (only well-formed objects are migrated).
UPDATE "reservations" r SET
  penalty_kind = (r.custom_fields->'_sys'->'penalty'->>'kind')::"penalty_kind",
  penalty_amount = (r.custom_fields->'_sys'->'penalty'->>'amount')::bigint,
  penalty_computed_amount = GREATEST(
    (r.custom_fields->'_sys'->'penalty'->>'amount')::bigint,
    CASE WHEN r.custom_fields->'_sys'->'penalty'->>'computedAmount' ~ '^\d+$'
         THEN (r.custom_fields->'_sys'->'penalty'->>'computedAmount')::bigint ELSE 0 END),
  penalty_currency = COALESCE(r.custom_fields->'_sys'->'penalty'->>'currency', 'XOF'),
  penalty_waived = COALESCE(r.custom_fields->'_sys'->'penalty'->>'waived', 'false') = 'true'
                   AND (r.custom_fields->'_sys'->'penalty'->>'amount')::bigint = 0,
  penalty_business_date = CASE WHEN r.custom_fields->'_sys'->'penalty'->>'businessDate' ~ '^\d{4}-\d{2}-\d{2}$'
                               THEN (r.custom_fields->'_sys'->'penalty'->>'businessDate')::date
                               ELSE COALESCE(r.cancelled_at, r.updated_at)::date END,
  penalty_lines = CASE WHEN jsonb_typeof(r.custom_fields->'_sys'->'penalty'->'lines') = 'array'
                       THEN r.custom_fields->'_sys'->'penalty'->'lines' ELSE '[]'::jsonb END
 WHERE jsonb_typeof(r.custom_fields->'_sys'->'penalty') = 'object'
   AND r.custom_fields->'_sys'->'penalty'->>'kind' IN ('CANCELLATION', 'NO_SHOW')
   AND r.custom_fields->'_sys'->'penalty'->>'amount' ~ '^\d+$';

-- 2.2 Groups: allotment holder (first reservation of the group without booker), release date.
UPDATE "groups" g SET
  allotment_reservation_id = h.id,
  release_date = CASE WHEN h.custom_fields->'_sys'->'allotment'->>'releaseDate' ~ '^\d{4}-\d{2}-\d{2}$'
                      THEN (h.custom_fields->'_sys'->'allotment'->>'releaseDate')::date END
  FROM (SELECT DISTINCT ON (group_id) id, group_id, custom_fields
          FROM "reservations"
         WHERE group_id IS NOT NULL AND booker_guest_id IS NULL
         ORDER BY group_id, created_at, id) h
 WHERE h.group_id = g.id;

-- 2.3 Contracted block per room type: lines of the holder (held or released) + picked-up lines
-- of the group's reservations (a pick-up moves one held line into the guest's reservation).
INSERT INTO "group_blocks" (id, tenant_id, group_id, room_type_id, rooms, created_at)
SELECT gen_random_uuid(), g.tenant_id, g.id, rr.room_type_id, count(*)::int, g.created_at
  FROM "groups" g
  JOIN "reservations" r ON r.group_id = g.id
  JOIN "reservation_rooms" rr ON rr.reservation_id = r.id
 WHERE g.allotment_reservation_id IS NOT NULL
 GROUP BY g.tenant_id, g.id, rr.room_type_id, g.created_at;

-- 2.4 Waitlist: entry → reservation created when its offer was accepted.
UPDATE "waitlist_entries" w SET reservation_id = r.id
  FROM "reservations" r
 WHERE r.tenant_id = w.tenant_id
   AND r.custom_fields->'_sys'->>'waitlistEntryId' = w.id::text;

-- 2.5 The reserved key disappears from the custom fields.
UPDATE "reservations" SET custom_fields = custom_fields - '_sys' WHERE custom_fields ? '_sys';

-- ─────────────────────────── 3. Integrity & security ───────────────────────────
ALTER TABLE "reservations" ADD CONSTRAINT reservations_penalty_check CHECK (
  (penalty_kind IS NULL) = (penalty_amount IS NULL)
  AND (penalty_kind IS NULL) = (penalty_computed_amount IS NULL)
  AND (penalty_kind IS NULL) = (penalty_currency IS NULL)
  AND (penalty_kind IS NULL) = (penalty_business_date IS NULL)
  AND (penalty_kind IS NULL) = (penalty_lines IS NULL)
  AND (penalty_kind IS NOT NULL OR NOT penalty_waived)
  AND (penalty_amount IS NULL OR (penalty_amount >= 0 AND penalty_amount <= penalty_computed_amount))
  AND (NOT penalty_waived OR penalty_amount = 0)
  AND (penalty_lines IS NULL OR jsonb_typeof(penalty_lines) = 'array'));
-- `_sys` is no longer a reserved key: refuse it so the workaround cannot come back.
ALTER TABLE "reservations" ADD CONSTRAINT reservations_custom_fields_check
  CHECK (jsonb_typeof(custom_fields) = 'object' AND NOT custom_fields ? '_sys');
ALTER TABLE "group_blocks" ADD CONSTRAINT group_blocks_rooms_check CHECK (rooms > 0);

ALTER TABLE "group_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_blocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "group_blocks" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON "group_blocks" TO hm_app;
