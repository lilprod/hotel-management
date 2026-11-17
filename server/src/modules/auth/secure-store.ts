import { runWithTenant } from '@hm/database';
import type { Services } from '../../core/container.js';

/**
 * Durable per-principal security data with no dedicated column in the schema (reported gap):
 * password history and hashed MFA backup codes. Tenant users → `settings` (USER scope, internal
 * `_iam.*` keys never registered in the settings registry, so never exposed by settings APIs);
 * platform users → `platform_settings` (`_platform_user.<id>.<key>`).
 */
export type SecureKey = 'password_history' | 'mfa_backup_codes';

export interface Principal {
  kind: 'staff' | 'guest' | 'platform';
  id: string;
  tenantId?: string | undefined;
}

const settingKey = (k: SecureKey, kind: Principal['kind']) =>
  kind === 'guest' ? `_portal.${k}` : `_iam.${k}`;
const platformKey = (id: string, k: SecureKey) => `_platform_user.${id}.${k}`;

export async function readSecure(
  services: Services,
  p: Principal,
  k: SecureKey,
): Promise<string[]> {
  if (p.kind === 'platform') {
    const row = await services.admin.platformSetting.findUnique({
      where: { key: platformKey(p.id, k) },
    });
    return asStrings(row?.value);
  }
  const tenantId = p.tenantId!;
  const row = await runWithTenant(tenantId, () =>
    services.db.setting.findFirst({
      where: { scope: 'USER', scopeId: p.id, key: settingKey(k, p.kind) },
      select: { value: true },
    }),
  );
  return asStrings(row?.value);
}

export async function writeSecure(
  services: Services,
  p: Principal,
  k: SecureKey,
  value: string[],
): Promise<void> {
  if (p.kind === 'platform') {
    const key = platformKey(p.id, k);
    await services.admin.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return;
  }
  const tenantId = p.tenantId!;
  const key = settingKey(k, p.kind);
  await runWithTenant(tenantId, async () => {
    const row = await services.db.setting.findFirst({
      where: { scope: 'USER', scopeId: p.id, key },
      select: { id: true },
    });
    if (row) await services.db.setting.update({ where: { id: row.id }, data: { value } });
    else
      await services.db.setting.create({
        data: { tenantId, scope: 'USER', scopeId: p.id, key, value },
      });
  });
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
