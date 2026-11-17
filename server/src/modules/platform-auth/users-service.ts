import type { Request } from 'express';
import { AppError, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../middleware/audit.js';
import { invalidatePlatformUser, type PlatformRoleKey } from '../../middleware/platform-guard.js';
import { diffJson } from '../audit/service.js';
import { clearMfa } from '../auth/mfa.js';
import { revokeAllRedisSessions } from '../auth/redis-sessions.js';
import { platformPasswordHash } from './service.js';

interface PlatformUserRow {
  id: string;
  email: string;
  name: string;
  role: PlatformRoleKey;
  isActive: boolean;
  totpSecretEnc: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function serialize(u: PlatformUserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    mfaEnabled: !!u.totpSecretEnc,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

async function find(req: Request, id: string) {
  const u = await req.services.admin.platformUser.findUnique({ where: { id } });
  if (!u) throw notFound('Platform user not found');
  return u;
}

export async function listPlatformUsers(req: Request) {
  const rows = await req.services.admin.platformUser.findMany({ orderBy: { name: 'asc' } });
  return { items: rows.map(serialize) };
}

export async function createPlatformUser(
  req: Request,
  body: { email: string; name: string; role: PlatformRoleKey; password: string },
) {
  const { admin } = req.services;
  if (await admin.platformUser.findUnique({ where: { email: body.email } }))
    throw new AppError('CONFLICT', 'A platform user with this e-mail already exists', {
      meta: { reason: 'EMAIL_TAKEN' },
    });
  const passwordHash = await platformPasswordHash(
    req.services,
    { id: '', email: body.email, passwordHash: null },
    body.password,
  );
  const u = await admin.platformUser.create({
    data: { email: body.email, name: body.name, role: body.role, passwordHash },
  });
  const out = serialize(u);
  recordAudit(req, {
    action: 'platform.user_created',
    entity: 'platform_user',
    entityId: u.id,
    after: out,
  });
  return out;
}

async function assertKeepsSuperAdmin(req: Request, id: string) {
  const others = await req.services.admin.platformUser.count({
    where: { role: 'SUPER_ADMIN', isActive: true, id: { not: id } },
  });
  if (others === 0)
    throw new AppError('CONFLICT', 'The last super admin cannot be demoted or deactivated', {
      meta: { reason: 'LAST_SUPER_ADMIN' },
    });
}

export async function updatePlatformUser(
  req: Request,
  id: string,
  body: {
    name?: string | undefined;
    role?: PlatformRoleKey | undefined;
    isActive?: boolean | undefined;
  },
) {
  const { services } = req;
  const before = await find(req, id);
  const demoted = before.role === 'SUPER_ADMIN' && body.role && body.role !== 'SUPER_ADMIN';
  const deactivated = before.isActive && body.isActive === false;
  if (id === req.auth!.userId && (demoted || deactivated))
    throw new AppError('CONFLICT', 'You cannot demote or deactivate yourself', {
      meta: { reason: 'SELF_CHANGE' },
    });
  if ((demoted || deactivated) && before.role === 'SUPER_ADMIN')
    await assertKeepsSuperAdmin(req, id);
  const after = await services.admin.platformUser.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });
  if (deactivated) await revokeAllRedisSessions(services, 'platform', null, id);
  await invalidatePlatformUser(services, id);
  recordAudit(req, {
    action: 'platform.user_updated',
    entity: 'platform_user',
    entityId: id,
    ...diffJson(serialize(before), serialize(after)),
  });
  return serialize(after);
}

/** Lost device: clears the TOTP secret; the next login goes through enrolment again. */
export async function resetPlatformUserMfa(req: Request, id: string) {
  const { services } = req;
  await find(req, id);
  await services.admin.platformUser.update({ where: { id }, data: { totpSecretEnc: null } });
  await clearMfa(services, { kind: 'platform', id });
  await revokeAllRedisSessions(services, 'platform', null, id);
  await invalidatePlatformUser(services, id);
  recordAudit(req, { action: 'platform.user_mfa_reset', entity: 'platform_user', entityId: id });
}
