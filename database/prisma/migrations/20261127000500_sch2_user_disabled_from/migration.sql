-- SCH-2 group 5 — SCH-1 leftover: re-enabling a disabled user restores the status held before
-- (a self-signup owner who never verified the e-mail goes back to PENDING_VERIFICATION, not ACTIVE).
--   * users.disabled_from_status (was: lost; re-activation guessed ACTIVE from the password).
-- Section 1 is Prisma's DDL; sections 2+ are hand-written.

-- ─────────────────────────── 1. DDL (prisma migrate diff) ───────────────────────────
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabled_from_status" "user_status";

-- ─────────────────────────── 2. Data migration ───────────────────────────
-- Disabled users: the status recorded by the last deactivation audit; else a self-signup owner
-- (tenant audit `tenant.signup`) without `tenant.owner_email_verified` is PENDING_VERIFICATION;
-- else INVITED without password, ACTIVE with one.
UPDATE "users" u SET disabled_from_status = COALESCE(
    (SELECT (a.before->>'status')::"user_status" FROM "audit_logs" a
      WHERE a.tenant_id = u.tenant_id AND a.entity = 'user' AND a.entity_id = u.id::text
        AND a.action = 'iam.user_deactivated'
        AND a.before->>'status' IN ('INVITED', 'PENDING_VERIFICATION', 'ACTIVE')
      ORDER BY a.at DESC LIMIT 1),
    CASE
      WHEN EXISTS (SELECT 1 FROM "audit_logs" a WHERE a.tenant_id = u.tenant_id AND a.user_id = u.id AND a.action = 'tenant.signup')
       AND NOT EXISTS (SELECT 1 FROM "audit_logs" a WHERE a.tenant_id = u.tenant_id AND a.user_id = u.id
                         AND a.action = 'tenant.owner_email_verified')
       AND u.last_login_at IS NULL
        THEN 'PENDING_VERIFICATION'
      WHEN u.password_hash IS NULL THEN 'INVITED'
      ELSE 'ACTIVE' END::"user_status")
 WHERE u.status = 'DISABLED';

-- ─────────────────────────── 3. Integrity ───────────────────────────
ALTER TABLE "users" ADD CONSTRAINT users_disabled_from_status_check CHECK (
  disabled_from_status IS NULL OR (status = 'DISABLED' AND disabled_from_status <> 'DISABLED'));
