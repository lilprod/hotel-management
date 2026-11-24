-- Hotel invoices and credit notes are immutable once issued (OP-92, doc 03 §5).
-- Only the status (payment / credit progress) and the PDF file may change; corrections are made
-- by credit notes. DELETE is forbidden. Hand-written: `prisma migrate diff` stays empty.

CREATE OR REPLACE FUNCTION hm_invoice_guard() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  allowed text[] := ARRAY['status', 'pdf_file_id', 'updated_at'];
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
  RETURN NEW;
END
$fn$;

CREATE TRIGGER invoices_restrict_update BEFORE UPDATE OR DELETE ON "invoices" FOR EACH ROW
  EXECUTE FUNCTION hm_invoice_guard();
