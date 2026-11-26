-- SCH-2 group 3 (2/2) — invoicing.
--   * invoices.kind INTERIM / FINAL / COMPANY / CREDIT_NOTE (was: inferred from totals.interim,
--     the folio and credit_note_of_id).
--   * invoices.ledger_amount (part payable through the city ledger, was: totals.payments) and
--     ledger_allocations (settlement on a company account ↔ invoice) so that a city-ledger invoice
--     becomes PARTIALLY_PAID / PAID; the invoice guard checks the status against the allocations.
--   * fiscal_documents.status SKIPPED (was: ACCEPTED + payload.skipped = true).
--   * No VOID status: an issued hotel invoice is never voided, it is cancelled by a credit note
--     (CREDITED when fully credited) — there is no draft invoice to void (doc 03 §5, doc 09 §3).
-- Section 1 is Prisma's DDL; sections 2+ are hand-written.

-- ─────────────────────────── 1. DDL (prisma migrate diff) ───────────────────────────
-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('INTERIM', 'FINAL', 'COMPANY', 'CREDIT_NOTE');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "kind" "invoice_kind" NOT NULL DEFAULT 'FINAL',
ADD COLUMN     "ledger_amount" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ledger_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "amount" BIGINT NOT NULL,
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "ledger_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_allocations_reversal_of_id_key" ON "ledger_allocations"("reversal_of_id");

-- CreateIndex
CREATE INDEX "ledger_allocations_tenant_id_idx" ON "ledger_allocations"("tenant_id");

-- CreateIndex
CREATE INDEX "ledger_allocations_settlement_id_idx" ON "ledger_allocations"("settlement_id");

-- CreateIndex
CREATE INDEX "ledger_allocations_invoice_id_idx" ON "ledger_allocations"("invoice_id");

-- AddForeignKey
ALTER TABLE "ledger_allocations" ADD CONSTRAINT "ledger_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_allocations" ADD CONSTRAINT "ledger_allocations_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "folio_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_allocations" ADD CONSTRAINT "ledger_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_allocations" ADD CONSTRAINT "ledger_allocations_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "ledger_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────── 2. Data migration ───────────────────────────
ALTER TABLE "invoices" DISABLE TRIGGER invoices_restrict_update;
UPDATE "invoices" i SET kind = (CASE
    WHEN i.credit_note_of_id IS NOT NULL THEN 'CREDIT_NOTE'
    WHEN i.totals->>'interim' = 'true' THEN 'INTERIM'
    WHEN f.kind = 'COMPANY' THEN 'COMPANY'
    ELSE 'FINAL' END)::"invoice_kind"
  FROM "folios" f
 WHERE f.id = i.folio_id;
UPDATE "invoices" i SET ledger_amount = LEAST(GREATEST(i.total, 0), COALESCE(
    (SELECT sum((p->>'amount')::bigint) FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(i.totals->'payments') = 'array' THEN i.totals->'payments' ELSE '[]'::jsonb END) p
      WHERE p->>'method' = 'CITY_LEDGER' AND p->>'amount' ~ '^-?\d+$'), 0))
 WHERE i.kind <> 'CREDIT_NOTE';
UPDATE "invoices" SET ledger_amount = 0 WHERE ledger_amount < 0;
ALTER TABLE "invoices" ENABLE TRIGGER invoices_restrict_update;

UPDATE "fiscal_documents" SET status = 'SKIPPED', payload = payload - 'skipped'
 WHERE status = 'ACCEPTED' AND payload->>'skipped' = 'true';

-- ─────────────────────────── 3. Integrity & security ───────────────────────────
ALTER TABLE "invoices" ADD CONSTRAINT invoices_kind_check CHECK (
  (kind = 'CREDIT_NOTE') = (credit_note_of_id IS NOT NULL)
  AND ledger_amount >= 0
  AND (kind <> 'CREDIT_NOTE' OR ledger_amount = 0)
  AND ledger_amount <= GREATEST(total, 0));
ALTER TABLE "fiscal_documents" ADD CONSTRAINT fiscal_documents_skipped_check
  CHECK (status <> 'SKIPPED' OR fiscal_number IS NULL);
ALTER TABLE "ledger_allocations" ADD CONSTRAINT ledger_allocations_amount_check CHECK (
  amount <> 0 AND ((reversal_of_id IS NULL) = (amount > 0)));

-- Allocation rules: a positive allocation takes a confirmed settlement of a company account in
-- the invoice currency, without exceeding what is left on the settlement nor on the invoice; a
-- counter-allocation cancels exactly one allocation.
CREATE OR REPLACE FUNCTION hm_ledger_allocation_guard() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  s record;
  inv record;
  orig record;
  used bigint;
BEGIN
  SELECT p.amount, p.status, p.currency, f.kind AS folio_kind INTO s
    FROM folio_payments p JOIN folios f ON f.id = p.folio_id WHERE p.id = NEW.settlement_id;
  SELECT kind, ledger_amount, currency INTO inv FROM invoices WHERE id = NEW.invoice_id;
  IF NEW.reversal_of_id IS NOT NULL THEN
    SELECT * INTO orig FROM ledger_allocations WHERE id = NEW.reversal_of_id;
    IF orig.id IS NULL OR orig.reversal_of_id IS NOT NULL OR orig.settlement_id <> NEW.settlement_id
       OR orig.invoice_id <> NEW.invoice_id OR NEW.amount <> -orig.amount THEN
      RAISE EXCEPTION 'A counter-allocation must cancel exactly one allocation' USING ERRCODE = 'HM001';
    END IF;
    RETURN NEW;
  END IF;
  IF s.folio_kind IS DISTINCT FROM 'COMPANY' OR s.status <> 'CONFIRMED' OR s.amount <= 0 THEN
    RAISE EXCEPTION 'Only a confirmed settlement of a company account can be allocated' USING ERRCODE = 'HM001';
  END IF;
  IF inv.kind = 'CREDIT_NOTE' OR inv.ledger_amount <= 0 OR inv.currency <> s.currency OR NEW.currency <> s.currency THEN
    RAISE EXCEPTION 'The invoice has nothing payable through the city ledger in this currency' USING ERRCODE = 'HM001';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO used FROM ledger_allocations WHERE settlement_id = NEW.settlement_id;
  IF used + NEW.amount > s.amount THEN
    RAISE EXCEPTION 'The allocations exceed the settlement amount' USING ERRCODE = 'HM001';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO used FROM ledger_allocations WHERE invoice_id = NEW.invoice_id;
  IF used + NEW.amount > inv.ledger_amount THEN
    RAISE EXCEPTION 'The allocations exceed the amount payable through the city ledger' USING ERRCODE = 'HM001';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER ledger_allocations_guard BEFORE INSERT ON "ledger_allocations" FOR EACH ROW
  EXECUTE FUNCTION hm_ledger_allocation_guard();
CREATE TRIGGER ledger_allocations_append_only BEFORE UPDATE OR DELETE ON "ledger_allocations" FOR EACH ROW
  EXECUTE FUNCTION hm_reject_mutation();

-- Invoice guard: unchanged immutability; a city-ledger invoice's payment status must match its
-- allocations (ISSUED → PARTIALLY_PAID → PAID, back on a reversed settlement).
CREATE OR REPLACE FUNCTION hm_invoice_guard() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  allowed text[] := ARRAY['status', 'pdf_file_id', 'updated_at'];
  allocated bigint;
  due text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on %.% is forbidden: issue a credit note instead', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'HM001';
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'UPDATE on %.% may only change: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, array_to_string(allowed, ', ')
      USING ERRCODE = 'HM001';
  END IF;
  IF OLD.status = 'CREDITED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A fully credited invoice cannot change status'
      USING ERRCODE = 'HM001';
  END IF;
  IF OLD.pdf_file_id IS NOT NULL AND NEW.pdf_file_id IS NULL THEN
    RAISE EXCEPTION 'The PDF of an issued invoice cannot be removed'
      USING ERRCODE = 'HM001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.ledger_amount > 0
     AND NEW.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') THEN
    SELECT COALESCE(sum(amount), 0) INTO allocated FROM ledger_allocations WHERE invoice_id = NEW.id;
    due := CASE WHEN allocated >= NEW.ledger_amount THEN 'PAID'
                WHEN allocated > 0 THEN 'PARTIALLY_PAID' ELSE 'ISSUED' END;
    IF NEW.status::text <> due THEN
      RAISE EXCEPTION 'Invoice status % does not match its city-ledger allocations (%)', NEW.status, due
        USING ERRCODE = 'HM001';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

ALTER TABLE "ledger_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_allocations" USING (tenant_id = hm_current_tenant()) WITH CHECK (tenant_id = hm_current_tenant());
GRANT SELECT, INSERT ON "ledger_allocations" TO hm_app;
