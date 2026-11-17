import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { ipOf, writePlatformAudit, writeTenantAudit } from '../audit/service.js';
import { IMPERSONATION_UA_PREFIX } from '../auth/service.js';
import { issueAccessToken, randomToken, sha256 } from '../auth/tokens.js';

export const IMPERSONATION_MAX_MINUTES = 30;

/**
 * Support impersonation (doc 05 §4, SA-25, TN-18): SUPPORT / SUPER_ADMIN, tenant consent
 * (`allow_impersonation`), a reason, ≤ 30 min. Issues a non-refreshable staff token for a tenant
 * user carrying `impersonated_by`; restricted actions are enforced by the staff gates. Traced in
 * the platform audit and in the tenant audit (with `impersonated_by`).
 */
export async function startImpersonation(
  req: Request,
  body: { tenantId: string; reason: string; durationMinutes: number; userId?: string | undefined },
) {
  const { services } = req;
  const { admin } = services;
  const agent = req.platformUser!;
  const tenant = await admin.tenant.findFirst({
    where: { id: body.tenantId, deletedAt: null },
    include: {
      securityPolicy: { select: { allowImpersonation: true } },
      tenantDomains: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!tenant) throw notFound('Tenant not found');
  const allowed = tenant.securityPolicy
    ? tenant.securityPolicy.allowImpersonation
    : tenant.allowImpersonation;
  if (!allowed)
    throw forbidden('The tenant does not allow support access', {
      reason: 'IMPERSONATION_NOT_ALLOWED',
    });
  const user = await admin.user.findFirst({
    where: {
      tenantId: tenant.id,
      status: 'ACTIVE',
      deletedAt: null,
      ...(body.userId
        ? { id: body.userId }
        : { userRoles: { some: { role: { rolePermissions: { some: { permissionKey: '*' } } } } } }),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw notFound('No active user to impersonate');

  const minutes = Math.min(body.durationMinutes, IMPERSONATION_MAX_MINUTES);
  const sid = randomUUID();
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  await admin.session.create({
    data: {
      id: sid,
      tenantId: tenant.id,
      userId: user.id,
      // Not refreshable: the stored hash matches no token ever handed out.
      refreshHash: sha256(`impersonation:${randomToken(32)}`),
      ip: ipOf(req),
      userAgent: `${IMPERSONATION_UA_PREFIX} ${agent.email}`.slice(0, 512),
      expiresAt,
    },
  });
  const access = await issueAccessToken(
    services,
    {
      sub: user.id,
      tid: tenant.id,
      sid,
      scope: 'staff',
      perm_ver: await services.permVersions.current(tenant.id),
      impersonated_by: agent.id,
    },
    minutes * 60,
  );
  const details = {
    reason: body.reason,
    platformUser: { id: agent.id, email: agent.email, name: agent.name },
    userId: user.id,
    sessionId: sid,
    durationMinutes: minutes,
    expiresAt: expiresAt.toISOString(),
  };
  const ip = ipOf(req);
  const userAgent = req.header('user-agent') ?? null;
  await writePlatformAudit(services, {
    actorId: agent.id,
    action: 'impersonation.started',
    entity: 'tenant',
    entityId: tenant.id,
    after: details,
    ip,
    userAgent,
  });
  await writeTenantAudit(services, {
    tenantId: tenant.id,
    userId: user.id,
    impersonatedBy: agent.id,
    action: 'impersonation.started',
    entity: 'session',
    entityId: sid,
    after: details,
    ip,
    userAgent,
  });
  const host =
    tenant.tenantDomains.find((d) => d.type === 'CUSTOM' && d.verifiedAt)?.hostname ??
    tenant.tenantDomains.find((d) => d.type === 'SUBDOMAIN')?.hostname ??
    null;
  return {
    ...access,
    sessionId: sid,
    expiresAt: expiresAt.toISOString(),
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, host },
    user,
  };
}

export async function endImpersonation(req: Request, sessionId: string) {
  const { services } = req;
  const agent = req.platformUser!;
  const session = await services.admin.session.findUnique({ where: { id: sessionId } });
  if (!session?.userAgent?.startsWith(IMPERSONATION_UA_PREFIX))
    throw notFound('Impersonation session not found');
  if (session.revokedAt)
    throw new AppError('CONFLICT', 'Already ended', { meta: { reason: 'ALREADY_ENDED' } });
  await services.admin.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
  await services.revocations.revoke(sessionId, IMPERSONATION_MAX_MINUTES * 60);
  const after = { sessionId, endedBy: agent.id };
  await writePlatformAudit(services, {
    actorId: agent.id,
    action: 'impersonation.ended',
    entity: 'tenant',
    entityId: session.tenantId,
    after,
    ip: ipOf(req),
  });
  await writeTenantAudit(services, {
    tenantId: session.tenantId,
    userId: session.userId,
    impersonatedBy: agent.id,
    action: 'impersonation.ended',
    entity: 'session',
    entityId: sessionId,
    after,
    ip: ipOf(req),
  });
}

export async function listImpersonationEvents(req: Request, tenantId?: string) {
  const rows = await req.services.admin.platformAuditLog.findMany({
    where: {
      action: { startsWith: 'impersonation.' },
      ...(tenantId ? { entityId: tenantId } : {}),
    },
    orderBy: { at: 'desc' },
    take: 200,
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.at.toISOString(),
      actorId: r.actorId,
      tenantId: r.entityId,
      details: r.after ?? null,
    })),
  };
}
