import { runWithTenant } from '@hm/database';
import type { Services } from '../../core/container.js';

/**
 * Durable per-principal security data: password history and hashed single-use MFA backup codes.
 * Tenant users → `password_history` / `mfa_backup_codes` (RLS, tenant context); platform users →
 * `platform_password_history` / `platform_mfa_backup_codes` (admin client).
 */
export interface Principal {
  kind: 'staff' | 'platform';
  id: string;
  tenantId?: string | undefined;
}

const inTenant = <T>(p: Principal, fn: () => Promise<T>) => runWithTenant(p.tenantId!, fn);

/** Previous password hashes, newest first (the current hash is not part of the history). */
export async function passwordHistory(services: Services, p: Principal): Promise<string[]> {
  const rows =
    p.kind === 'platform'
      ? await services.admin.platformPasswordHistory.findMany({
          where: { platformUserId: p.id },
          orderBy: { createdAt: 'desc' },
          select: { hash: true },
        })
      : await inTenant(p, () =>
          services.db.passwordHistory.findMany({
            where: { userId: p.id },
            orderBy: { createdAt: 'desc' },
            select: { hash: true },
          }),
        );
  return rows.map((r) => r.hash);
}

/** Pushes the replaced hash on top of the history and keeps only the `keep` newest entries. */
export async function pushPasswordHistory(
  services: Services,
  p: Principal,
  replacedHash: string | null,
  keep: number,
): Promise<void> {
  if (p.kind === 'platform') {
    const db = services.admin.platformPasswordHistory;
    if (replacedHash) await db.create({ data: { platformUserId: p.id, hash: replacedHash } });
    const stale = await db.findMany({
      where: { platformUserId: p.id },
      orderBy: { createdAt: 'desc' },
      skip: keep,
      select: { id: true },
    });
    if (stale.length) await db.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    return;
  }
  await inTenant(p, async () => {
    const db = services.db.passwordHistory;
    if (replacedHash)
      await db.create({ data: { tenantId: p.tenantId!, userId: p.id, hash: replacedHash } });
    const stale = await db.findMany({
      where: { userId: p.id },
      orderBy: { createdAt: 'desc' },
      skip: keep,
      select: { id: true },
    });
    if (stale.length) await db.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  });
}

/** Replaces every backup code of the principal (empty list = MFA disabled). */
export async function replaceBackupCodes(
  services: Services,
  p: Principal,
  hashes: readonly string[],
): Promise<void> {
  if (p.kind === 'platform') {
    await services.admin.$transaction([
      services.admin.platformMfaBackupCode.deleteMany({ where: { platformUserId: p.id } }),
      services.admin.platformMfaBackupCode.createMany({
        data: hashes.map((codeHash) => ({ platformUserId: p.id, codeHash })),
      }),
    ]);
    return;
  }
  await inTenant(p, async () => {
    await services.db.mfaBackupCode.deleteMany({ where: { userId: p.id } });
    if (hashes.length)
      await services.db.mfaBackupCode.createMany({
        data: hashes.map((codeHash) => ({ tenantId: p.tenantId!, userId: p.id, codeHash })),
      });
  });
}

/** Marks an unused backup code as used; false when it does not exist or was already used. */
export async function consumeBackupCode(
  services: Services,
  p: Principal,
  hash: string,
): Promise<boolean> {
  const now = new Date();
  const out =
    p.kind === 'platform'
      ? await services.admin.platformMfaBackupCode.updateMany({
          where: { platformUserId: p.id, codeHash: hash, usedAt: null },
          data: { usedAt: now },
        })
      : await inTenant(p, () =>
          services.db.mfaBackupCode.updateMany({
            where: { userId: p.id, codeHash: hash, usedAt: null },
            data: { usedAt: now },
          }),
        );
  return out.count === 1;
}

export async function remainingBackupCodes(services: Services, p: Principal): Promise<number> {
  return p.kind === 'platform'
    ? services.admin.platformMfaBackupCode.count({ where: { platformUserId: p.id, usedAt: null } })
    : inTenant(p, () => services.db.mfaBackupCode.count({ where: { userId: p.id, usedAt: null } }));
}
