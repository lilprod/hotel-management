-- SCH-2 group 4 — night audit.
--   * properties.closed_through_date (was: last night_audits.summary.locked = true), enforced by a
--     trigger on folio_lines / folio_payments (a posting dated in a closed day is refused).
--   * night_audits.locked_at (was: summary.lockedAt).
--   * daily_stats_property: revenue_total, vat_total, tourist_tax_total, taxes, payments_by_method,
--     payments_total, arrivals, departures, in_house, no_shows (were: night_audits.summary.kpis
--     only); the KPIs are read from these columns, payments by business_date.
-- Section 1 is Prisma's DDL; sections 2+ are hand-written.

-- ─────────────────────────── 1. DDL (prisma migrate diff) ───────────────────────────
-- AlterTable
ALTER TABLE "daily_stats_property" ADD COLUMN     "arrivals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "departures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "in_house" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "no_shows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payments_by_method" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "payments_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "revenue_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "taxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tourist_tax_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "vat_total" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "night_audits" ADD COLUMN     "locked_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "closed_through_date" DATE;

-- ─────────────────────────── 2. Data migration ───────────────────────────
UPDATE "night_audits" SET locked_at = COALESCE(
    CASE WHEN summary->>'lockedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (summary->>'lockedAt')::timestamptz END,
    completed_at, updated_at)
 WHERE summary->>'locked' = 'true';

UPDATE "properties" p SET closed_through_date = x.d
  FROM (SELECT property_id, max(business_date) AS d FROM "night_audits" WHERE locked_at IS NOT NULL GROUP BY property_id) x
 WHERE x.property_id = p.id;

-- KPIs of the summary → columns (the row exists when the stats step ran; created otherwise).
INSERT INTO "daily_stats_property" (id, tenant_id, property_id, business_date, currency, updated_at)
SELECT gen_random_uuid(), a.tenant_id, a.property_id, a.business_date, COALESCE(a.summary->'kpis'->>'currency', 'XOF'), now()
  FROM "night_audits" a
 WHERE jsonb_typeof(a.summary->'kpis') = 'object'
ON CONFLICT (property_id, business_date) DO NOTHING;
UPDATE "daily_stats_property" d SET
  revenue_total = COALESCE((k->>'totalRevenue')::bigint, d.revenue_total),
  vat_total = COALESCE((k->>'vatTotal')::bigint, 0),
  tourist_tax_total = COALESCE((k->>'touristTaxTotal')::bigint, 0),
  taxes = CASE WHEN jsonb_typeof(k->'taxes') = 'array' THEN k->'taxes' ELSE '[]'::jsonb END,
  payments_by_method = CASE WHEN jsonb_typeof(k->'payments') = 'array' THEN k->'payments' ELSE '[]'::jsonb END,
  payments_total = COALESCE((k->>'paymentsTotal')::bigint, 0),
  arrivals = COALESCE((k->>'arrivals')::int, 0),
  departures = COALESCE((k->>'departures')::int, 0),
  in_house = COALESCE((k->>'inHouse')::int, 0),
  no_shows = COALESCE((k->>'noShows')::int, 0),
  occupied = COALESCE((k->>'roomsSold')::int, d.occupied),
  available = COALESCE((k->>'roomsAvailable')::int, d.available),
  revenue_room = COALESCE((k->>'roomRevenue')::bigint, d.revenue_room),
  adr = COALESCE((k->>'adr')::bigint, d.adr),
  revpar = COALESCE((k->>'revpar')::bigint, d.revpar),
  revenue_by_dept = CASE WHEN jsonb_typeof(k->'revenueByDept') = 'object' THEN k->'revenueByDept' ELSE d.revenue_by_dept END
  FROM (SELECT property_id, business_date, summary->'kpis' AS k FROM "night_audits"
         WHERE jsonb_typeof(summary->'kpis') = 'object') a
 WHERE a.property_id = d.property_id AND a.business_date = d.business_date;

-- The workaround keys leave the summary (it keeps the run state: steps, decisions, warnings).
UPDATE "night_audits" SET summary = summary - 'kpis' - 'locked' - 'lockedAt'
 WHERE summary ?| ARRAY['kpis', 'locked', 'lockedAt'];

-- ─────────────────────────── 3. Integrity ───────────────────────────
ALTER TABLE "daily_stats_property" ADD CONSTRAINT daily_stats_property_counts_check CHECK (
  arrivals >= 0 AND departures >= 0 AND in_house >= 0 AND no_shows >= 0 AND occupied >= 0 AND available >= 0
  AND jsonb_typeof(taxes) = 'array' AND jsonb_typeof(payments_by_method) = 'array');

-- A closed business day is final: postings and payments dated on or before it are refused
-- (corrections are reversals dated in the open day). Backstop of the application check.
CREATE OR REPLACE FUNCTION hm_closed_day_guard() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  closed date;
BEGIN
  SELECT closed_through_date INTO closed FROM properties WHERE id = NEW.property_id;
  IF closed IS NOT NULL AND NEW.business_date <= closed THEN
    RAISE EXCEPTION 'The business day % is closed (closed through %)', NEW.business_date, closed
      USING ERRCODE = 'HM002';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER folio_lines_closed_day BEFORE INSERT ON "folio_lines" FOR EACH ROW EXECUTE FUNCTION hm_closed_day_guard();
CREATE TRIGGER folio_payments_closed_day BEFORE INSERT ON "folio_payments" FOR EACH ROW EXECUTE FUNCTION hm_closed_day_guard();
