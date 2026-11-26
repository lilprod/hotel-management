-- SCH-2 group 3 (1/2) — "no fiscalisation" gets its own status (was: ACCEPTED + payload.skipped).
-- Alone in its migration: a new enum value cannot be used in the transaction that adds it.

-- AlterEnum
ALTER TYPE "fiscal_document_status" ADD VALUE 'SKIPPED';
