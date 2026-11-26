import { runWithTenant, type Prisma } from '@hm/database';
import { ALL_PERMISSIONS, hasPermission, PERMISSION_CATALOG } from '@hm/shared';
import type { Request } from 'express';
import type { EffectivePolicy } from '../../core/security-policy.js';
import { loadGrants } from '../../http/helpers.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../middleware/audit.js';
import { ipAllowed } from '../../middleware/security-gates.js';
import { diffJson } from '../audit/service.js';
import { sendAuthMessage } from '../auth/mailer.js';
import { clearMfa } from '../auth/mfa.js';
import { INVITE_TTL_S, inviteKey, inviteUserKey, revokeStaffSessions } from '../auth/service.js';
import { randomToken, sha256 } from '../auth/tokens.js';

type UserStatus = 'INVITED' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';

const tenantId = (req: Request) => req.tenant!.id;
const db = (req: Request) => req.services.db;
const inTenant = <T>(req: Request, fn: () => Promise<T>) => runWithTenant(tenantId(req), fn);

// ---------------------------------------------------------------------------
// Permission keys and privilege escalation
// ---------------------------------------------------------------------------

const KNOWN = new Set<string>(ALL_PERMISSIONS);
const MODULES = new Set(Object.keys(PERMISSION_CATALOG));

/** `*`, a catalog permission, or a wildcard on a catalog prefix (`folio.*`, `restaurant.orders.*`). */
export function isValidPermissionKey(key: string): boolean {
  if (key === '*' || KNOWN.has(key)) return true;
  if (!key.endsWith('.*')) return false;
  const prefix = key.slice(0, -2);
  if (MODULES.has(prefix)) return true;
  return ALL_PERMISSIONS.some((p) => p.startsWith(`${prefix}.`));
}

function assertPermissionKeys(keys: readonly string[]) {
  const bad = keys.filter((k) => !isValidPermissionKey(k));
  if (bad.length)
    throw new AppError('VALIDATION_ERROR', 'Unknown permission', {
      errors: bad.map((k) => ({ path: 'permissions', message: `Unknown permission ${k}` })),
    });
}

/** A user can only grant (to a role or through a role) what they hold themselves. */
async function assertCanGrant(req: Request, permissions: readonly string[]) {
  const grants = await loadGrants(req);
  const missing = permissions.filter((p) => !hasPermission(grants.permissions, p));
  if (missing.length)
    throw forbidden('You cannot grant permissions you do not hold', {
      reason: 'PRIVILEGE_ESCALATION',
      permissions: missing,
    });
}

async function rolesByIds(req: Request, roleIds: readonly string[]) {
  const roles = await inTenant(req, () =>
    db(req).role.findMany({
      where: { id: { in: [...roleIds] } },
      include: { rolePermissions: { select: { permissionKey: true } } },
    }),
  );
  if (roles.length !== new Set(roleIds).size)
    throw new AppError('VALIDATION_ERROR', 'Unknown role', {
      errors: [{ path: 'roleIds', message: 'Unknown role' }],
    });
  return roles;
}

async function assertProperties(req: Request, propertyIds: readonly string[]) {
  if (!propertyIds.length) return;
  const n = await inTenant(req, () =>
    db(req).property.count({ where: { id: { in: [...propertyIds] } } }),
  );
  if (n !== new Set(propertyIds).size)
    throw new AppError('VALIDATION_ERROR', 'Unknown property', {
      errors: [{ path: 'propertyIds', message: 'Unknown property' }],
    });
}

const bumpPermissions = (req: Request) => req.services.permVersions.bump(tenantId(req));

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const userInclude = {
  userRoles: { select: { role: { select: { id: true, name: true, isSystem: true } } } },
  userProperties: { select: { propertyId: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function serializeUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    status: u.status as UserStatus,
    mfaEnabled: !!u.totpSecretEnc,
    mustChangePassword: u.mustChangePassword,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    roles: u.userRoles.map((r) => r.role).sort((a, b) => a.name.localeCompare(b.name)),
    propertyIds: u.userProperties.map((p) => p.propertyId).sort(),
  };
}

async function findUser(req: Request, id: string): Promise<UserRow> {
  const u = await inTenant(req, () =>
    db(req).user.findFirst({ where: { id, deletedAt: null }, include: userInclude }),
  );
  if (!u) throw notFound('User not found');
  return u;
}

export async function listUsers(
  req: Request,
  q: {
    q?: string | undefined;
    status?: UserStatus | undefined;
    roleId?: string | undefined;
    propertyId?: string | undefined;
  },
) {
  const rows = await inTenant(req, () =>
    db(req).user.findMany({
      where: {
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.roleId ? { userRoles: { some: { roleId: q.roleId } } } : {}),
        ...(q.propertyId ? { userProperties: { some: { propertyId: q.propertyId } } } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' as const } },
                { email: { contains: q.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: userInclude,
      orderBy: { name: 'asc' },
      take: 500,
    }),
  );
  return { items: rows.map(serializeUser) };
}

export async function getUser(req: Request, id: string) {
  return serializeUser(await findUser(req, id));
}

/** Users counted against the `users` quota (active + pending invitations). */
export function countSeats(req: Request) {
  return inTenant(req, () =>
    db(req).user.count({
      where: { deletedAt: null, status: { in: ['ACTIVE', 'INVITED', 'PENDING_VERIFICATION'] } },
    }),
  );
}

async function sendInvitation(req: Request, user: UserRow) {
  const { services } = req;
  const tenant = req.tenant!;
  const token = randomToken(32);
  const hash = sha256(token);
  const previous = await services.redis.get(inviteUserKey(user.id));
  if (previous) await services.redis.del(inviteKey(tenant.id, previous));
  await services.redis
    .multi()
    .set(inviteKey(tenant.id, hash), user.id, 'EX', INVITE_TTL_S)
    .set(inviteUserKey(user.id), hash, 'EX', INVITE_TTL_S)
    .exec();
  const inviter = await loadGrants(req);
  await sendAuthMessage(services, {
    tenantId: tenant.id,
    to: { email: user.email },
    templateCode: 'user_invitation',
    userId: user.id,
    data: {
      invitee: { name: user.name },
      inviter: { name: inviter.name },
      hotel: { name: tenant.name },
      invitation: {
        role: user.userRoles.map((r) => r.role.name).join(', '),
        url: `https://${tenant.hostname}/accept-invite?token=${encodeURIComponent(token)}`,
        expiresInDays: INVITE_TTL_S / 86_400,
      },
    },
    idempotencyKey: `invite:${hash}`,
  });
}

export async function createUser(
  req: Request,
  body: {
    email: string;
    name: string;
    phone?: string | undefined;
    roleIds: string[];
    propertyIds: string[];
  },
) {
  const tid = tenantId(req);
  const roles = await rolesByIds(req, body.roleIds);
  await assertCanGrant(
    req,
    roles.flatMap((r) => r.rolePermissions.map((p) => p.permissionKey)),
  );
  await assertProperties(req, body.propertyIds);
  const existing = await inTenant(req, () =>
    db(req).user.findFirst({ where: { email: { equals: body.email, mode: 'insensitive' } } }),
  );
  if (existing)
    throw new AppError('CONFLICT', 'A user with this e-mail already exists', {
      meta: { reason: 'EMAIL_TAKEN' },
    });
  const created = await inTenant(req, () =>
    db(req).user.create({
      data: {
        tenantId: tid,
        email: body.email,
        name: body.name,
        phone: body.phone ?? null,
        status: 'INVITED',
        userRoles: { create: body.roleIds.map((roleId) => ({ tenantId: tid, roleId })) },
        userProperties: {
          create: [...new Set(body.propertyIds)].map((propertyId) => ({
            tenantId: tid,
            propertyId,
          })),
        },
      },
      include: userInclude,
    }),
  );
  await sendInvitation(req, created);
  const out = serializeUser(created);
  recordAudit(req, {
    action: 'iam.user_invited',
    entity: 'user',
    entityId: created.id,
    after: out,
  });
  return out;
}

export async function resendInvitation(req: Request, id: string) {
  const user = await findUser(req, id);
  if (user.status !== 'INVITED')
    throw new AppError('CONFLICT', 'The user already accepted the invitation', {
      meta: { reason: 'NOT_INVITED' },
    });
  await sendInvitation(req, user);
  recordAudit(req, { action: 'iam.invitation_resent', entity: 'user', entityId: id });
}

/** Active users holding `*` through any role (owners), optionally excluding one. */
async function ownerCount(req: Request, excludeUserId?: string) {
  return inTenant(req, () =>
    db(req).user.count({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        userRoles: { some: { role: { rolePermissions: { some: { permissionKey: '*' } } } } },
      },
    }),
  );
}

const isOwner = (u: UserRow & { userRoles: unknown }, ownerRoleIds: Set<string>) =>
  u.userRoles.some((r) => ownerRoleIds.has(r.role.id));

async function ownerRoleIds(req: Request) {
  const rows = await inTenant(req, () =>
    db(req).rolePermission.findMany({ where: { permissionKey: '*' }, select: { roleId: true } }),
  );
  return new Set(rows.map((r) => r.roleId));
}

async function assertNotLastOwner(req: Request, user: UserRow) {
  if (user.status !== 'ACTIVE' || !isOwner(user, await ownerRoleIds(req))) return;
  if ((await ownerCount(req, user.id)) === 0)
    throw new AppError('CONFLICT', 'The last owner cannot lose the owner role', {
      meta: { reason: 'LAST_OWNER' },
    });
}

export async function updateUser(
  req: Request,
  id: string,
  body: {
    name?: string | undefined;
    phone?: string | null | undefined;
    roleIds?: string[] | undefined;
    propertyIds?: string[] | undefined;
    mustChangePassword?: boolean | undefined;
  },
) {
  const tid = tenantId(req);
  const before = await findUser(req, id);
  if (body.roleIds) {
    const roles = await rolesByIds(req, body.roleIds);
    await assertCanGrant(
      req,
      roles.flatMap((r) => r.rolePermissions.map((p) => p.permissionKey)),
    );
    // Removing roles is also a grant decision: the removed roles must be within reach.
    const removed = before.userRoles.filter((r) => !body.roleIds!.includes(r.role.id));
    if (removed.length) {
      const removedRoles = await rolesByIds(
        req,
        removed.map((r) => r.role.id),
      );
      await assertCanGrant(
        req,
        removedRoles.flatMap((r) => r.rolePermissions.map((p) => p.permissionKey)),
      );
      const owners = await ownerRoleIds(req);
      if (isOwner(before, owners) && !body.roleIds.some((r) => owners.has(r)))
        await assertNotLastOwner(req, before);
    }
  }
  if (body.propertyIds) await assertProperties(req, body.propertyIds);
  await inTenant(req, async () => {
    await db(req).user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.mustChangePassword !== undefined
          ? { mustChangePassword: body.mustChangePassword }
          : {}),
      },
    });
    if (body.roleIds) {
      await db(req).userRole.deleteMany({ where: { userId: id, roleId: { notIn: body.roleIds } } });
      await db(req).userRole.createMany({
        data: body.roleIds.map((roleId) => ({ tenantId: tid, userId: id, roleId })),
        skipDuplicates: true,
      });
    }
    if (body.propertyIds) await replaceProperties(req, id, body.propertyIds);
  });
  if (body.roleIds || body.propertyIds) await bumpPermissions(req);
  if (body.mustChangePassword) await revokeStaffSessions(req.services, tid, { userId: id });
  const after = serializeUser(await findUser(req, id));
  recordAudit(req, {
    action: 'iam.user_updated',
    entity: 'user',
    entityId: id,
    ...diffJson(serializeUser(before), after),
  });
  return after;
}

async function replaceProperties(req: Request, userId: string, propertyIds: readonly string[]) {
  const tid = tenantId(req);
  await db(req).userProperty.deleteMany({
    where: { userId, propertyId: { notIn: [...propertyIds] } },
  });
  await db(req).userProperty.createMany({
    data: [...new Set(propertyIds)].map((propertyId) => ({ tenantId: tid, userId, propertyId })),
    skipDuplicates: true,
  });
}

export async function setUserProperties(req: Request, id: string, propertyIds: string[]) {
  const before = await findUser(req, id);
  await assertProperties(req, propertyIds);
  await inTenant(req, () => replaceProperties(req, id, propertyIds));
  await bumpPermissions(req);
  const after = serializeUser(await findUser(req, id));
  recordAudit(req, {
    action: 'iam.user_properties_set',
    entity: 'user',
    entityId: id,
    before: { propertyIds: before.userProperties.map((p) => p.propertyId).sort() },
    after: { propertyIds: after.propertyIds },
  });
  return after;
}

export async function setUserStatus(req: Request, id: string, active: boolean) {
  const tid = tenantId(req);
  const user = await findUser(req, id);
  if (!active) {
    if (id === req.auth!.userId)
      throw new AppError('CONFLICT', 'You cannot deactivate yourself', {
        meta: { reason: 'SELF_DEACTIVATION' },
      });
    await assertCanGrant(
      req,
      (
        await rolesByIds(
          req,
          user.userRoles.map((r) => r.role.id),
        )
      ).flatMap((r) => r.rolePermissions.map((p) => p.permissionKey)),
    );
    await assertNotLastOwner(req, user);
  }
  const status: UserStatus = !active
    ? 'DISABLED'
    : user.status === 'PENDING_VERIFICATION'
      ? 'PENDING_VERIFICATION'
      : user.passwordHash
        ? 'ACTIVE'
        : 'INVITED';
  await inTenant(req, () =>
    db(req).user.update({
      where: { id },
      data: { status, ...(active ? { failedAttempts: 0, lockedUntil: null } : {}) },
    }),
  );
  if (!active) await revokeStaffSessions(req.services, tid, { userId: id });
  await bumpPermissions(req);
  recordAudit(req, {
    action: active ? 'iam.user_activated' : 'iam.user_deactivated',
    entity: 'user',
    entityId: id,
    before: { status: user.status },
    after: { status },
  });
  return serializeUser(await findUser(req, id));
}

export async function revokeUserSessions(req: Request, id: string) {
  await findUser(req, id);
  const ids = await revokeStaffSessions(req.services, tenantId(req), { userId: id });
  recordAudit(req, {
    action: 'iam.user_sessions_revoked',
    entity: 'user',
    entityId: id,
    after: { sessions: ids.length },
  });
  return { revoked: ids.length };
}

export async function resetUserMfa(req: Request, id: string) {
  const user = await findUser(req, id);
  await inTenant(req, () => db(req).user.update({ where: { id }, data: { totpSecretEnc: null } }));
  await clearMfa(req.services, { kind: 'staff', id, tenantId: tenantId(req) });
  await revokeStaffSessions(req.services, tenantId(req), { userId: id });
  recordAudit(req, {
    action: 'iam.user_mfa_reset',
    entity: 'user',
    entityId: id,
    before: { mfaEnabled: !!user.totpSecretEnc },
    after: { mfaEnabled: false },
  });
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const roleInclude = {
  rolePermissions: { select: { permissionKey: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function serializeRole(r: RoleRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.rolePermissions.map((p) => p.permissionKey).sort(),
    userCount: r._count.userRoles,
  };
}

async function findRole(req: Request, id: string) {
  const r = await inTenant(req, () =>
    db(req).role.findFirst({ where: { id }, include: roleInclude }),
  );
  if (!r) throw notFound('Role not found');
  return r;
}

const systemReadOnly = () =>
  new AppError('FORBIDDEN', 'System roles cannot be modified: clone them instead', {
    meta: { reason: 'SYSTEM_ROLE_READONLY' },
  });

export async function listRoles(req: Request) {
  const rows = await inTenant(req, () =>
    db(req).role.findMany({
      include: roleInclude,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    }),
  );
  return { items: rows.map(serializeRole) };
}

export async function getRole(req: Request, id: string) {
  return serializeRole(await findRole(req, id));
}

async function insertRole(
  req: Request,
  data: { name: string; description?: string | null | undefined; permissions: string[] },
) {
  const tid = tenantId(req);
  const permissions = [...new Set(data.permissions)];
  assertPermissionKeys(permissions);
  await assertCanGrant(req, permissions);
  const role = await inTenant(req, () =>
    db(req).role.create({
      data: {
        tenantId: tid,
        name: data.name,
        description: data.description ?? null,
        isSystem: false,
        rolePermissions: {
          create: permissions.map((permissionKey) => ({ tenantId: tid, permissionKey })),
        },
      },
      include: roleInclude,
    }),
  );
  return serializeRole(role);
}

export async function createRole(
  req: Request,
  body: { name: string; description?: string | undefined; permissions: string[] },
) {
  const role = await insertRole(req, body);
  recordAudit(req, { action: 'iam.role_created', entity: 'role', entityId: role.id, after: role });
  return role;
}

export async function cloneRole(
  req: Request,
  id: string,
  body: { name: string; description?: string | undefined },
) {
  const source = await findRole(req, id);
  const role = await insertRole(req, {
    name: body.name,
    description: body.description ?? source.description,
    permissions: source.rolePermissions.map((p) => p.permissionKey),
  });
  recordAudit(req, {
    action: 'iam.role_cloned',
    entity: 'role',
    entityId: role.id,
    after: { ...role, clonedFrom: id },
  });
  return role;
}

export async function updateRole(
  req: Request,
  id: string,
  body: { name?: string | undefined; description?: string | null | undefined },
) {
  const before = await findRole(req, id);
  if (before.isSystem) throw systemReadOnly();
  await inTenant(req, () =>
    db(req).role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
    }),
  );
  const after = serializeRole(await findRole(req, id));
  recordAudit(req, {
    action: 'iam.role_updated',
    entity: 'role',
    entityId: id,
    ...diffJson(serializeRole(before), after),
  });
  return after;
}

export async function setRolePermissions(req: Request, id: string, permissions: string[]) {
  const before = await findRole(req, id);
  if (before.isSystem) throw systemReadOnly();
  const tid = tenantId(req);
  const next = [...new Set(permissions)];
  assertPermissionKeys(next);
  const current = before.rolePermissions.map((p) => p.permissionKey);
  // Adding and removing both require holding the permission.
  await assertCanGrant(req, [
    ...next.filter((p) => !current.includes(p)),
    ...current.filter((p) => !next.includes(p)),
  ]);
  await inTenant(req, async () => {
    await db(req).rolePermission.deleteMany({
      where: { roleId: id, permissionKey: { notIn: next } },
    });
    await db(req).rolePermission.createMany({
      data: next.map((permissionKey) => ({ tenantId: tid, roleId: id, permissionKey })),
      skipDuplicates: true,
    });
  });
  await bumpPermissions(req);
  const after = serializeRole(await findRole(req, id));
  recordAudit(req, {
    action: 'iam.role_permissions_set',
    entity: 'role',
    entityId: id,
    before: { permissions: current.sort() },
    after: { permissions: after.permissions },
  });
  return after;
}

export async function deleteRole(req: Request, id: string) {
  const role = await findRole(req, id);
  if (role.isSystem)
    throw new AppError('FORBIDDEN', 'System roles cannot be deleted', {
      meta: { reason: 'SYSTEM_ROLE' },
    });
  if (role._count.userRoles > 0)
    throw new AppError('CONFLICT', 'The role is still assigned to users', {
      meta: { reason: 'ROLE_IN_USE', userCount: role._count.userRoles },
    });
  await assertCanGrant(
    req,
    role.rolePermissions.map((p) => p.permissionKey),
  );
  await inTenant(req, () => db(req).role.delete({ where: { id } }));
  await bumpPermissions(req);
  recordAudit(req, {
    action: 'iam.role_deleted',
    entity: 'role',
    entityId: id,
    before: serializeRole(role),
  });
}

export function permissionCatalog() {
  return {
    modules: Object.entries(PERMISSION_CATALOG).map(([module, actions]) => ({
      module,
      permissions: actions.map((a) => `${module}.${a}`),
    })),
  };
}

// ---------------------------------------------------------------------------
// Security policy
// ---------------------------------------------------------------------------

export async function getPolicy(req: Request): Promise<EffectivePolicy> {
  return req.services.securityPolicies.fetch(tenantId(req));
}

export async function updatePolicy(req: Request, body: Partial<EffectivePolicy>) {
  const { services } = req;
  const tid = tenantId(req);
  const before = await services.securityPolicies.fetch(tid);
  const next: EffectivePolicy = { ...before, ...body };
  if (body.ipAllowlist?.length) {
    if (!(await services.entitlements.has(tid, 'security.ip_restriction')))
      throw new AppError('FEATURE_NOT_IN_PLAN', undefined, {
        detail: 'Feature security.ip_restriction is not included in your subscription',
        meta: { feature: 'security.ip_restriction' },
      });
    const ip = req.ip?.replace(/^::ffff:/, '') ?? null;
    if (!ipAllowed(body.ipAllowlist, ip))
      throw new AppError('VALIDATION_ERROR', 'Your current IP address would be locked out', {
        errors: [{ path: 'ipAllowlist', message: `Current IP ${ip ?? '?'} is not in the list` }],
        meta: { reason: 'IP_LOCKOUT', ip },
      });
  }
  if (body.mfaRoles?.length) await rolesByIds(req, body.mfaRoles);
  if (next.mfaMode === 'REQUIRED_FOR_ROLES' && !next.mfaRoles.length)
    throw new AppError('VALIDATION_ERROR', 'Select at least one role', {
      errors: [{ path: 'mfaRoles', message: 'Required with REQUIRED_FOR_ROLES' }],
    });
  const data = {
    pwdMinLength: next.pwdMinLength,
    pwdRequireClasses: next.pwdRequireClasses,
    pwdExpiryDays: next.pwdExpiryDays,
    pwdHistory: next.pwdHistory,
    mfaMode: next.mfaMode,
    mfaRoles: next.mfaRoles,
    sessionIdleMinutes: next.sessionIdleMinutes,
    maxSessions: next.maxSessions,
    lockoutThreshold: next.lockoutThreshold,
    lockoutMinutes: next.lockoutMinutes,
    ipAllowlist: next.ipAllowlist,
    allowImpersonation: next.allowImpersonation,
  };
  await inTenant(req, () =>
    db(req).securityPolicy.upsert({
      where: { tenantId: tid },
      create: { tenantId: tid, ...data },
      update: data,
    }),
  );
  if (before.allowImpersonation !== next.allowImpersonation)
    await services.admin.tenant.update({
      where: { id: tid },
      data: { allowImpersonation: next.allowImpersonation },
    });
  await services.securityPolicies.invalidate(tid);
  const after = await services.securityPolicies.fetch(tid);
  recordAudit(req, {
    action: 'security.policy_updated',
    entity: 'security_policy',
    entityId: tid,
    ...diffJson(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    ),
  });
  return after;
}

// ---------------------------------------------------------------------------
// Impersonation sessions seen by the tenant (TN-18)
// ---------------------------------------------------------------------------

export async function listImpersonations(req: Request) {
  const rows = await inTenant(req, () =>
    db(req).auditLog.findMany({
      where: { action: { startsWith: 'impersonation.' } },
      orderBy: { at: 'desc' },
      take: 200,
    }),
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.at.toISOString(),
      platformUserId: r.impersonatedBy,
      userId: r.userId,
      sessionId: r.entityId,
      details: r.after ?? null,
    })),
  };
}
