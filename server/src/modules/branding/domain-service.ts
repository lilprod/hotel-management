import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Services } from '../../core/container.js';
import { CORE_EVENTS, publishPlatformEvent } from '../../core/events.js';
import { normalizeHost } from '../../core/tenants.js';
import { AppError, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../middleware/audit.js';
import { brandingDeps } from './deps.js';
import type { DomainView } from './schemas.js';

export const CHALLENGE_LABEL = '_hm-challenge';
export const CHALLENGE_PREFIX = 'hm-site-verification=';

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Lower-cases and validates a fully qualified domain name (no IP, no port, no wildcard). */
export function parseHostname(raw: string): string {
  const host = normalizeHost(raw.includes('://') ? new URL(raw).host : raw);
  const labels = host.split('.');
  const ok =
    host.length <= 253 &&
    labels.length >= 2 &&
    isIP(host) === 0 &&
    labels.every((l) => LABEL_RE.test(l)) &&
    /^[a-z]{2,63}$/.test(labels[labels.length - 1] as string) &&
    !raw.includes('/') &&
    !raw.includes(':');
  if (!ok)
    throw new AppError('VALIDATION_ERROR', undefined, {
      errors: [{ path: 'hostname', message: 'Not a valid domain name', code: 'invalid_hostname' }],
    });
  return host;
}

export class DomainService {
  constructor(private readonly services: Services) {}

  /** Deterministic ownership token: nothing to store, and unguessable without the server secret. */
  token(tenantId: string, hostname: string): string {
    return createHmac('sha256', this.services.config.JWT_ACCESS_SECRET)
      .update(`custom-domain:${tenantId}:${hostname}`)
      .digest('hex')
      .slice(0, 40);
  }

  private async load(tenantId: string) {
    const rows = await this.services.admin.tenantDomain.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      sub: rows.find((r) => r.type === 'SUBDOMAIN') ?? null,
      custom: rows.find((r) => r.type === 'CUSTOM') ?? null,
    };
  }

  async view(tenantId: string): Promise<DomainView> {
    const { sub, custom } = await this.load(tenantId);
    return {
      subdomain: sub ? { hostname: sub.hostname } : null,
      custom: custom
        ? {
            hostname: custom.hostname,
            status: custom.verifiedAt ? 'VERIFIED' : 'PENDING_VERIFICATION',
            verifiedAt: custom.verifiedAt?.toISOString() ?? null,
            tlsStatus: custom.tlsStatus,
            txtRecord: {
              name: `${CHALLENGE_LABEL}.${custom.hostname}`,
              value: `${CHALLENGE_PREFIX}${this.token(tenantId, custom.hostname)}`,
            },
          }
        : null,
    };
  }

  /** Hosts reserved by the platform (admin / marketing hosts and their sub-domains). */
  private isReserved(host: string): boolean {
    const { adminHosts, platformHosts } = {
      adminHosts: this.services.config.ADMIN_HOSTS,
      platformHosts: this.services.config.PLATFORM_HOSTS,
    };
    return [...adminHosts, ...platformHosts].some((h) => host === h || host.endsWith(`.${h}`));
  }

  private async changed(req: Request, tenantId: string, hostname: string, action: string) {
    await this.services.tenants.invalidateHost(hostname);
    await this.services.tenants.invalidateTenant(tenantId);
    await publishPlatformEvent(this.services.admin, tenantId, CORE_EVENTS.tenantDomainsChanged, {
      hostname,
      action,
    });
    recordAudit(req, { action: `branding.domain.${action}`, entity: 'tenant_domain', after: { hostname } });
  }

  async add(req: Request, tenantId: string, rawHostname: string): Promise<DomainView> {
    const hostname = parseHostname(rawHostname);
    if (this.isReserved(hostname))
      throw new AppError('VALIDATION_ERROR', undefined, {
        errors: [{ path: 'hostname', message: 'This domain is reserved by the platform', code: 'reserved_hostname' }],
      });
    const { custom } = await this.load(tenantId);
    if (custom)
      throw new AppError('CONFLICT', undefined, {
        detail: 'A custom domain is already configured; remove it first',
      });
    const taken = await this.services.admin.tenantDomain.findUnique({ where: { hostname } });
    if (taken)
      throw new AppError('CONFLICT', undefined, { detail: 'This domain is already in use' });
    await this.services.admin.tenantDomain.create({
      data: { tenantId, hostname, type: 'CUSTOM', tlsStatus: 'PENDING' },
    });
    await this.changed(req, tenantId, hostname, 'add');
    return this.view(tenantId);
  }

  /** Looks up the TXT challenge; marks the domain verified when the token is found. */
  async verify(req: Request, tenantId: string): Promise<DomainView> {
    const { custom } = await this.load(tenantId);
    if (!custom) throw notFound('No custom domain configured');
    const expected = `${CHALLENGE_PREFIX}${this.token(tenantId, custom.hostname)}`;
    let found: string[];
    try {
      found = await brandingDeps(this.services).dns.resolveTxt(
        `${CHALLENGE_LABEL}.${custom.hostname}`,
      );
    } catch (err) {
      throw new AppError('SERVICE_UNAVAILABLE', undefined, {
        detail: 'DNS lookup failed, retry later',
        cause: err,
      });
    }
    const matched = found.some((v) => v.trim() === expected);
    if (matched && !custom.verifiedAt) {
      await this.services.admin.tenantDomain.update({
        where: { id: custom.id },
        data: { verifiedAt: new Date() },
      });
      await this.changed(req, tenantId, custom.hostname, 'verify');
    }
    // Values of other TXT records are not echoed back (only whether ours was seen).
    return { ...(await this.view(tenantId)), check: { matched, found: found.map(maskTxt) } };
  }

  async remove(req: Request, tenantId: string): Promise<void> {
    const { custom } = await this.load(tenantId);
    if (!custom) throw notFound('No custom domain configured');
    await this.services.admin.tenantDomain.delete({ where: { id: custom.id } });
    await this.changed(req, tenantId, custom.hostname, 'remove');
  }
}

function maskTxt(v: string): string {
  return v.startsWith(CHALLENGE_PREFIX) ? v : `${v.slice(0, 4)}…`;
}
