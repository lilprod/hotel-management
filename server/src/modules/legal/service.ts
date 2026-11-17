import { runWithTenant } from '@hm/database';
import type { Request } from 'express';
import type { Services } from '../../core/container.js';
import { loadGrants } from '../../http/helpers.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { recordAudit } from '../../middleware/audit.js';
import { ipOf } from '../audit/service.js';

/** Documents the tenant owner must accept before using the staff API (doc 08 EX-04). */
export const REQUIRED_LEGAL_TYPES = ['TOS', 'DPA'] as const;
export type RequiredLegalType = (typeof REQUIRED_LEGAL_TYPES)[number];

export interface LegalDocSummary {
  id: string;
  type: string;
  version: string;
  locale: string;
  publishedAt: string;
}

const LATEST_KEY = 'hm:legal:latest';
const pendingKey = (tenantId: string) => `hm:legal:pending:${tenantId}`;
const LATEST_TTL_S = 60;
const PENDING_TTL_S = 300;

/** Latest published version of each required document (one per type, preferred locale first). */
export function latestDocuments(services: Services): Promise<LegalDocSummary[]> {
  return services.cache.wrap(LATEST_KEY, LATEST_TTL_S, async () => {
    const docs = await services.admin.legalDocument.findMany({
      where: { type: { in: [...REQUIRED_LEGAL_TYPES] }, publishedAt: { lte: new Date() } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, type: true, version: true, locale: true, publishedAt: true },
    });
    const out: LegalDocSummary[] = [];
    for (const type of REQUIRED_LEGAL_TYPES) {
      const latest = docs.find((d) => d.type === type);
      if (!latest) continue;
      const sameVersion = docs.filter((d) => d.type === type && d.version === latest.version);
      const doc = sameVersion.find((d) => d.locale === 'fr') ?? latest;
      out.push({
        id: doc.id,
        type: doc.type,
        version: doc.version,
        locale: doc.locale,
        publishedAt: doc.publishedAt!.toISOString(),
      });
    }
    return out;
  });
}

/** Required documents whose latest version the tenant has not accepted yet. */
export function pendingDocuments(services: Services, tenantId: string): Promise<LegalDocSummary[]> {
  return services.cache.wrap(pendingKey(tenantId), PENDING_TTL_S, async () => {
    const latest = await latestDocuments(services);
    if (!latest.length) return [];
    const accepted = await runWithTenant(tenantId, () =>
      services.db.legalAcceptance.findMany({
        where: {
          tenantId,
          OR: latest.map((d) => ({
            legalDocument: { type: d.type as RequiredLegalType },
            version: d.version,
          })),
        },
        select: { version: true, legalDocument: { select: { type: true } } },
      }),
    );
    return latest.filter(
      (d) => !accepted.some((a) => a.legalDocument.type === d.type && a.version === d.version),
    );
  });
}

export async function invalidateLegalCache(services: Services, tenantId?: string): Promise<void> {
  await services.cache.del(...(tenantId ? [pendingKey(tenantId)] : []), LATEST_KEY);
}

/** Only the owner (`*`) accepts on behalf of the tenant; never during an impersonation. */
export async function canAcceptLegal(req: Request): Promise<boolean> {
  if (req.auth?.scope !== 'staff' || req.auth.impersonatedBy) return false;
  const grants = await loadGrants(req);
  return grants.permissions.includes('*');
}

export async function legalStatus(req: Request) {
  const tenantId = req.tenant!.id;
  const [pending, canAccept] = await Promise.all([
    pendingDocuments(req.services, tenantId),
    canAcceptLegal(req),
  ]);
  return { pending, canAccept, blocked: pending.length > 0 };
}

export async function listDocuments(req: Request) {
  const { services } = req;
  const latest = await latestDocuments(services);
  const pending = await pendingDocuments(services, req.tenant!.id);
  const docs = await services.admin.legalDocument.findMany({
    where: { id: { in: latest.map((d) => d.id) } },
    select: { id: true, content: true },
  });
  return {
    items: latest.map((d) => ({
      ...d,
      content: docs.find((x) => x.id === d.id)?.content ?? '',
      accepted: !pending.some((p) => p.id === d.id),
    })),
  };
}

/** Records the acceptance of the given latest documents (ip, user, version). */
export async function acceptDocuments(req: Request, documentIds: string[]) {
  const { services } = req;
  const tenantId = req.tenant!.id;
  if (!(await canAcceptLegal(req)))
    throw forbidden('Only the tenant owner can accept the legal documents', {
      reason: 'LEGAL_OWNER_REQUIRED',
    });
  const latest = await latestDocuments(services);
  const targets = latest.filter((d) => documentIds.includes(d.id));
  if (targets.length !== new Set(documentIds).size)
    throw new AppError('VALIDATION_ERROR', 'Unknown or outdated legal document', {
      meta: { documentIds },
    });
  const pending = await pendingDocuments(services, tenantId);
  const toCreate = targets.filter((t) => pending.some((p) => p.id === t.id));
  const ip = ipOf(req);
  await runWithTenant(tenantId, () =>
    services.db.legalAcceptance.createMany({
      data: toCreate.map((d) => ({
        tenantId,
        legalDocumentId: d.id,
        userId: req.auth!.userId,
        version: d.version,
        ip,
      })),
    }),
  );
  await invalidateLegalCache(services, tenantId);
  for (const d of toCreate)
    recordAudit(req, {
      action: 'legal.accepted',
      entity: 'legal_document',
      entityId: d.id,
      after: { type: d.type, version: d.version, ip },
    });
  return legalStatus(req);
}
