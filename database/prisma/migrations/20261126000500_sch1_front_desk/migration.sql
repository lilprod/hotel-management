-- SCH-1 group 5 — front desk.
--   * police_records.property_id (was: join through the stay), business_date (was:
--     snapshot.businessDate), provenance / destination / purpose (were: snapshot only). The
--     snapshot stays as the legal copy; police records become immutable (signature set once).
--   * stay_events (RLS, append-only): room change, extension, shortening, early departure and
--     forced check-out with their reason (was: tenant audit only), backfilled from audit_logs.
-- Section 1 is Prisma's DDL, adapted to add the NOT NULL columns after their backfill.

-- ─────────────────────────── 1. DDL ───────────────────────────
-- CreateEnum
CREATE TYPE "stay_event_type" AS ENUM ('ROOM_CHANGE', 'EXTEND', 'SHORTEN', 'EARLY_DEPARTURE', 'CHECKOUT_OVERRIDE');

-- AlterTable (NOT NULL set in section 2 once filled)
ALTER TABLE "police_records" ADD COLUMN     "business_date" DATE,
ADD COLUMN     "destination" TEXT,
ADD COLUMN     "property_id" UUID,
ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "purpose" TEXT;

-- CreateTable
CREATE TABLE "stay_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stay_id" UUID NOT NULL,
    "type" "stay_event_type" NOT NULL,
    "reason" TEXT,
    "actor_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stay_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stay_events_tenant_id_idx" ON "stay_events"("tenant_id");

-- CreateIndex
CREATE INDEX "stay_events_stay_id_at_idx" ON "stay_events"("stay_id", "at");

-- CreateIndex
CREATE INDEX "police_records_property_id_business_date_idx" ON "police_records"("property_id", "business_date");

-- AddForeignKey
ALTER TABLE "police_records" ADD CONSTRAINT "police_records_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_events" ADD CONSTRAINT "stay_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_events" ADD CONSTRAINT "stay_events_stay_id_fkey" FOREIGN KEY ("stay_id") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────── 2. Data migration ───────────────────────────
-- 2.1 Police records: property of the reservation of the stay; business date of the snapshot
-- (fallback: local date of the check-in); structured provenance / destination / purpose.
UPDATE "police_records" pr SET
  property_id = res.property_id,
  business_date = CASE WHEN pr.snapshot->>'businessDate' ~ '^\d{4}-\d{2}-\d{2}$'
                       THEN (pr.snapshot->>'businessDate')::date
                       ELSE (s.checked_in_at AT TIME ZONE p.timezone)::date END,
  provenance = NULLIF(btrim(pr.snapshot->>'provenance'), ''),
  destination = NULLIF(btrim(pr.snapshot->>'destination'), ''),
  purpose = NULLIF(btrim(pr.snapshot->>'purpose'), '')
  FROM "stays" s
  JOIN "reservation_rooms" rr ON rr.id = s.reservation_room_id
  JOIN "reservations" res ON res.id = rr.reservation_id
  JOIN "properties" p ON p.id = res.property_id
 WHERE s.id = pr.stay_id;
ALTER TABLE "police_records" ALTER COLUMN "property_id" SET NOT NULL;
ALTER TABLE "police_records" ALTER COLUMN "business_date" SET NOT NULL;

-- 2.2 Stay events from the tenant audit trail (entity 'stay', entity_id = stay id).
INSERT INTO "stay_events" (id, tenant_id, stay_id, type, reason, actor_id, payload, at)
SELECT gen_random_uuid(), a.tenant_id, s.id,
       (CASE a.action
          WHEN 'front_desk.room_change' THEN 'ROOM_CHANGE'
          WHEN 'front_desk.extend' THEN 'EXTEND'
          WHEN 'front_desk.shorten' THEN 'SHORTEN'
          WHEN 'front_desk.early_departure' THEN 'EARLY_DEPARTURE'
          ELSE 'CHECKOUT_OVERRIDE' END)::"stay_event_type",
       COALESCE(a.after->>'reason', a.after->>'overrideReason'),
       a.user_id,
       jsonb_strip_nulls(jsonb_build_object('before', a.before, 'after', COALESCE(a.after, '{}'::jsonb) - 'reason' - 'overrideReason',
                                            'migratedFromAudit', a.id)),
       a.at
  FROM "audit_logs" a
  JOIN "stays" s ON s.id::text = a.entity_id AND s.tenant_id = a.tenant_id
 WHERE a.entity = 'stay'
   AND a.action IN ('front_desk.room_change', 'front_desk.extend', 'front_desk.shorten',
                    'front_desk.early_departure', 'front_desk.check_out.override');

-- ─────────────────────────── 3. Security & immutability ───────────────────────────
ALTER TABLE "stay_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stay_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stay_events" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());
GRANT SELECT, INSERT ON "stay_events" TO hm_app;
CREATE TRIGGER stay_events_append_only BEFORE UPDATE OR DELETE ON "stay_events" FOR EACH ROW EXECUTE FUNCTION hm_reject_mutation();
ALTER TABLE "stay_events" ADD CONSTRAINT stay_events_payload_check CHECK (jsonb_typeof(payload) = 'object');

-- Police records are the legal register: never deleted, only the signature may be added once.
CREATE OR REPLACE FUNCTION hm_police_record_guard() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  allowed text[] := ARRAY['signature_file_id', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on %.% is forbidden: the police register is immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'HM001';
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed)
     OR (OLD.signature_file_id IS NOT NULL AND NEW.signature_file_id IS DISTINCT FROM OLD.signature_file_id) THEN
    RAISE EXCEPTION 'UPDATE on %.% may only add the signature', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'HM001';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER police_records_restrict_update BEFORE UPDATE OR DELETE ON "police_records" FOR EACH ROW
  EXECUTE FUNCTION hm_police_record_guard();
