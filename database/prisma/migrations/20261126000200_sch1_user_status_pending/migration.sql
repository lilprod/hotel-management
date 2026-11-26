-- SCH-1 group 2 (part a) — user_status gains PENDING_VERIFICATION (self-signup owner whose
-- e-mail is not verified yet; was: INVITED + password hash). Kept in its own migration: a new
-- enum value cannot be used in the transaction that adds it.

-- AlterEnum
ALTER TYPE "user_status" ADD VALUE 'PENDING_VERIFICATION';
