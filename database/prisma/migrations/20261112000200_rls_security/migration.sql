-- Hand-written security migration (doc 03 §4-5, doc 05 §3/§7, doc 04 §4).
-- Prisma cannot express: roles/grants, RLS policies, exclusion constraints, partial unique
-- indexes, CHECK constraints and immutability triggers. Keep this file in sync with the
-- table list in schema.prisma: the test "every tenant table is protected" fails otherwise.

-- ─────────────────────────── 1. Roles ───────────────────────────
-- hm_app: runtime role of the tenant API. Subject to RLS (NOBYPASSRLS), owns nothing.
-- The migration/admin role (DATABASE_URL_ADMIN, owner of every object) must be SUPERUSER or
-- BYPASSRLS, because FORCE ROW LEVEL SECURITY also applies to table owners.
-- No password is set here: provision it out of band (ALTER ROLE hm_app PASSWORD ...).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hm_app') THEN
    CREATE ROLE hm_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hm_app' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'role hm_app must be NOSUPERUSER NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE WARNING 'migration role % is neither SUPERUSER nor BYPASSRLS: the admin client will not see tenant rows', current_user;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hm_app;

-- ─────────────────────────── 2. Helper functions ───────────────────────────
-- Current tenant of the transaction (set by the app client with set_config(..., true)).
CREATE OR REPLACE FUNCTION hm_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $fn$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $fn$;

-- Append-only tables: reject any UPDATE / DELETE (correct by reversal entries instead).
CREATE OR REPLACE FUNCTION hm_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '% on %.% is forbidden: table is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'HM001';
END
$fn$;

-- Payments: DELETE forbidden; UPDATE may only touch the columns passed as trigger arguments.
CREATE OR REPLACE FUNCTION hm_restrict_update() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  allowed text[] := TG_ARGV;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on %.% is forbidden: reverse the payment instead', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'HM001';
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'UPDATE on %.% may only change: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, array_to_string(allowed, ', ')
      USING ERRCODE = 'HM001';
  END IF;
  RETURN NEW;
END
$fn$;

-- ─────────────────────────── 3. Row Level Security ───────────────────────────
-- Policy: tenant_id = current_setting('app.tenant_id', true)::uuid (NULLIF guards the empty
-- string left by a previous transaction-local set_config on a pooled connection).

ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sequences" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "user_properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_properties" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_properties" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roles" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_permissions" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_roles" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "security_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "security_policies" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sessions" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "branding" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "message_templates" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "legal_acceptances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_acceptances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "legal_acceptances" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "properties" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "room_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "room_types" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rooms" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "room_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_blocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "room_blocks" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "taxes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "taxes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "taxes" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "rate_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rate_plans" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "seasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seasons" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "seasons" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rates" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "policies" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "guests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "guests" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "companies" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reservations" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "reservation_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reservation_rooms" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "unit_nights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "unit_nights" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "unit_nights" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waitlist_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "waitlist_entries" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "reservation_guests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation_guests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reservation_guests" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "groups" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "stays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stays" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stays" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "police_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "police_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "police_records" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "folios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folios" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "folios" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "folio_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folio_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "folio_lines" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoices" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "folio_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folio_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "folio_payments" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_sessions" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_movements" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "night_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "night_audits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "night_audits" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "hk_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hk_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hk_tasks" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "outlets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outlets" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "warehouses" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_movements" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_counts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_counts" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "stock_count_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_count_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_count_lines" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "suppliers" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_orders" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "files" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_events" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "guest_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "guest_accounts" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "guest_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "guest_requests" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "deposit_declarations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deposit_declarations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deposit_declarations" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "guest_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "guest_preferences" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "communications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "communications" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consents" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "loyalty_programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_programs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loyalty_programs" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "loyalty_tiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_tiers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loyalty_tiers" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "loyalty_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loyalty_accounts" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "loyalty_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loyalty_transactions" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "departments" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employees" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "shift_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shift_templates" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "staff_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_schedules" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "time_entries" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "leaves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leaves" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leaves" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tasks" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversations" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "conversation_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversation_members" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_preferences" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "floor_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "floor_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "floor_plans" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "dining_tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dining_tables" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "dining_tables" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "menu_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_categories" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "menu_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_items" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "daily_specials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_specials" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "daily_specials" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "orders" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_items" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "table_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "table_reservations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "table_reservations" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "spa_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spa_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "spa_services" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "therapists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "therapists" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "therapists" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "treatment_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treatment_rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "treatment_rooms" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointments" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "treatment_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treatment_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "treatment_records" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "packages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "packages" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "package_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "package_components" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "package_components" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activities" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "activity_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_slots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activity_slots" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "activity_bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activity_bookings" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inventory_items" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_levels" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recipes" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "recipe_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recipe_lines" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order_lines" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goods_receipts" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "goods_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipt_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goods_receipt_lines" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "reorder_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reorder_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reorder_suggestions" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assets" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "maintenance_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maintenance_requests" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_orders" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "preventive_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preventive_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "preventive_plans" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "room_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_status_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "room_status_history" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "settings" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());
CREATE POLICY platform_defaults_read ON "settings" FOR SELECT USING (tenant_id IS NULL);

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custom_field_definitions" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "lookup_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lookup_values" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lookup_values" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "fiscal_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal_documents" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "exchange_rates" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_jobs" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_rows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_rows" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "ledger_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_accounts" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "account_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "account_mappings" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "accounting_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_exports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_exports" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "period_closings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "period_closings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "period_closings" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "minibar_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "minibar_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "minibar_templates" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "minibar_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "minibar_counts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "minibar_counts" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "lost_found_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lost_found_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lost_found_items" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_keys" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_subscriptions" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_deliveries" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "daily_stats_property" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_stats_property" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "daily_stats_property" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

ALTER TABLE "daily_stats_department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_stats_department" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "daily_stats_department" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());

-- ─────────────────────────── 4. Grants for hm_app ───────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "sequences" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_properties" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "roles" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "role_permissions" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_roles" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "security_policies" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "branding" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_templates" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "legal_acceptances" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "properties" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "room_types" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "rooms" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "room_blocks" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "taxes" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_plans" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "seasons" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "rates" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "policies" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "guests" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "companies" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "reservations" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "reservation_rooms" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "unit_nights" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "waitlist_entries" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "reservation_guests" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "groups" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "stays" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "police_records" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "folios" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_sessions" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_movements" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "night_audits" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "hk_tasks" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "products" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outlets" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "warehouses" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_counts" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_count_lines" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "suppliers" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "files" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_events" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "guest_accounts" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "guest_requests" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "deposit_declarations" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "guest_preferences" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "communications" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "consents" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "loyalty_programs" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "loyalty_tiers" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "loyalty_accounts" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "departments" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "employees" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_templates" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_schedules" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "time_entries" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "leaves" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tasks" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "conversations" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "conversation_members" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preferences" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "floor_plans" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "dining_tables" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_categories" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_items" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_specials" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "orders" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_items" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "table_reservations" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "spa_services" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "therapists" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "treatment_rooms" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "appointments" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "treatment_records" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "packages" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "package_components" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "activities" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "activity_slots" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "activity_bookings" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_items" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_levels" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipes" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipe_lines" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_order_lines" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipts" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipt_lines" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "reorder_suggestions" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "assets" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "maintenance_requests" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "work_orders" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "preventive_plans" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "room_status_history" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "settings" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_field_definitions" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "lookup_values" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "fiscal_documents" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "exchange_rates" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_jobs" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_rows" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ledger_accounts" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_mappings" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "accounting_exports" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "period_closings" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "minibar_templates" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "minibar_counts" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "lost_found_items" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "api_keys" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_subscriptions" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_deliveries" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_stats_property" TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_stats_department" TO hm_app;
-- append-only tenant tables
GRANT SELECT, INSERT ON "audit_logs" TO hm_app;
GRANT SELECT, INSERT ON "folio_lines" TO hm_app;
GRANT SELECT, INSERT ON "loyalty_transactions" TO hm_app;
GRANT SELECT, INSERT ON "stock_movements" TO hm_app;
GRANT SELECT, INSERT, UPDATE ON "folio_payments" TO hm_app;
-- read-only platform catalogue (no tenant data). Every other platform table is admin-only.
GRANT SELECT ON "plans" TO hm_app;
GRANT SELECT ON "plan_prices" TO hm_app;
GRANT SELECT ON "plan_features" TO hm_app;
GRANT SELECT ON "plan_quotas" TO hm_app;
GRANT SELECT ON "addons" TO hm_app;
GRANT SELECT ON "addon_prices" TO hm_app;
GRANT SELECT ON "tax_rules" TO hm_app;
GRANT SELECT ON "legal_documents" TO hm_app;

-- ─────────────────────────── 5. Immutability triggers ───────────────────────────
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION hm_reject_mutation();
CREATE TRIGGER folio_lines_append_only BEFORE UPDATE OR DELETE ON "folio_lines" FOR EACH ROW EXECUTE FUNCTION hm_reject_mutation();
CREATE TRIGGER loyalty_transactions_append_only BEFORE UPDATE OR DELETE ON "loyalty_transactions" FOR EACH ROW EXECUTE FUNCTION hm_reject_mutation();
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION hm_reject_mutation();
CREATE TRIGGER platform_audit_logs_append_only BEFORE UPDATE OR DELETE ON "platform_audit_logs" FOR EACH ROW EXECUTE FUNCTION hm_reject_mutation();
CREATE TRIGGER payments_restrict_update BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW
  EXECUTE FUNCTION hm_restrict_update('status', 'validated_by', 'validated_at', 'reversed_by', 'reversed_at', 'reversal_reason', 'receipt_number', 'updated_at');
CREATE TRIGGER folio_payments_restrict_update BEFORE UPDATE OR DELETE ON "folio_payments" FOR EACH ROW
  EXECUTE FUNCTION hm_restrict_update('status', 'reversed_by_id', 'reversed_at', 'reversal_reason', 'updated_at');

-- ─────────────────────────── 6. Anti-double-booking & integrity ───────────────────────────
-- unit_nights UNIQUE (unit_id, night) is declared in schema.prisma (@@unique).

-- Spa: a therapist / a treatment room cannot have two overlapping active appointments.
ALTER TABLE "appointments" ADD CONSTRAINT appointments_period_check CHECK (end_at > start_at);
ALTER TABLE "appointments" ADD CONSTRAINT appointments_therapist_no_overlap
  EXCLUDE USING gist (therapist_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));
ALTER TABLE "appointments" ADD CONSTRAINT appointments_treatment_room_no_overlap
  EXCLUDE USING gist (treatment_room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (treatment_room_id IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW'));

-- Restaurant: a table cannot hold two overlapping active reservations.
ALTER TABLE "table_reservations" ADD CONSTRAINT table_reservations_period_check CHECK (end_at > start_at);
ALTER TABLE "table_reservations" ADD CONSTRAINT table_reservations_table_no_overlap
  EXCLUDE USING gist (table_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (table_id IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED'));

-- Platform payments: a (method, reference) pair can only be used once unless reversed.
CREATE UNIQUE INDEX payments_method_reference_active_key ON "payments" (method, reference)
  WHERE reference IS NOT NULL AND status <> 'REVERSED';

-- Business CHECK constraints.
ALTER TABLE "payments" ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
ALTER TABLE "payment_declarations" ADD CONSTRAINT payment_declarations_amount_positive CHECK (amount > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT payment_allocations_amount_positive CHECK (amount > 0);
ALTER TABLE "reservations" ADD CONSTRAINT reservations_dates_check CHECK (departure > arrival);
ALTER TABLE "reservation_rooms" ADD CONSTRAINT reservation_rooms_dates_check CHECK (departure > arrival);
ALTER TABLE "waitlist_entries" ADD CONSTRAINT waitlist_entries_dates_check CHECK (departure > arrival);
ALTER TABLE "room_blocks" ADD CONSTRAINT room_blocks_dates_check CHECK (to_date >= from_date);
ALTER TABLE "staff_schedules" ADD CONSTRAINT staff_schedules_period_check CHECK (end_at > start_at);
ALTER TABLE "activity_slots" ADD CONSTRAINT activity_slots_capacity_check CHECK (booked >= 0 AND booked <= capacity);
ALTER TABLE "activity_slots" ADD CONSTRAINT activity_slots_period_check CHECK (end_at > start_at);
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT loyalty_accounts_balance_check CHECK (balance >= 0);
ALTER TABLE "feature_rollouts" ADD CONSTRAINT feature_rollouts_percentage_check CHECK (percentage BETWEEN 0 AND 100);
