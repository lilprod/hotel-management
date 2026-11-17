import type { Request, Response } from 'express';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { SIGNED_URL_TTL_S } from '../../lib/storage.js';
import { DomainService } from './domain-service.js';
import type {
  AssetKind,
  BrandingUpdate,
  PublicAssetKind,
  TemplateInput,
  TemplatePreviewInput,
} from './schemas.js';
import { BrandingService } from './service.js';
import { TemplateService } from './template-service.js';

function tenantOf(req: Request) {
  if (!req.tenant) throw new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });
  return req.tenant;
}

const branding = (req: Request) => new BrandingService(req.services);
const templates = (req: Request) => new TemplateService(req.services.db);
const domains = (req: Request) => new DomainService(req.services);

// --- branding -------------------------------------------------------------------------------

export const getBranding = (req: Request) => branding(req).view(tenantOf(req).id);

export const updateBranding = (req: Request, body: BrandingUpdate) =>
  branding(req).update(req, tenantOf(req).id, body);

export function uploadAsset(req: Request, kind: AssetKind) {
  if (!req.auth) throw forbidden('Staff token required');
  return branding(req).uploadAsset(req, tenantOf(req).id, req.auth.userId, kind, req.file);
}

export async function deleteAsset(req: Request, res: Response, kind: AssetKind) {
  await branding(req).removeAsset(req, tenantOf(req).id, kind);
  res.status(204).end();
}

export async function getSignedAsset(req: Request, kind: AssetKind) {
  const url = await branding(req).signedAssetUrl(kind);
  if (!url) throw notFound('Asset not set');
  return { url, expiresInSeconds: SIGNED_URL_TTL_S };
}

// --- templates ------------------------------------------------------------------------------

export const templateCatalog = (req: Request) => templates(req).catalog();
export const listTemplates = (
  req: Request,
  q: { channel?: string | undefined; code?: string | undefined; locale?: string | undefined },
) =>
  templates(req).list({
    ...(q.channel ? { channel: q.channel } : {}),
    ...(q.code ? { code: q.code } : {}),
    ...(q.locale ? { locale: q.locale } : {}),
  });
export const getTemplate = (req: Request, id: string) => templates(req).get(id);
export const createTemplate = (req: Request, body: TemplateInput) =>
  templates(req).create(req, tenantOf(req).id, body);
export const updateTemplate = (
  req: Request,
  id: string,
  body: { subject?: string | null | undefined; body: string },
) => templates(req).update(req, id, body);
export async function deleteTemplate(req: Request, res: Response, id: string) {
  await templates(req).remove(req, id);
  res.status(204).end();
}
export const previewTemplate = (req: Request, body: TemplatePreviewInput) =>
  templates(req).preview(body);

// --- custom domain --------------------------------------------------------------------------

export const getDomain = (req: Request) => domains(req).view(tenantOf(req).id);
export const addDomain = (req: Request, hostname: string) =>
  domains(req).add(req, tenantOf(req).id, hostname);
export const verifyDomain = (req: Request) => domains(req).verify(req, tenantOf(req).id);
export async function removeDomain(req: Request, res: Response) {
  await domains(req).remove(req, tenantOf(req).id);
  res.status(204).end();
}

// --- public portal --------------------------------------------------------------------------

export async function publicBranding(req: Request, res: Response) {
  const tenant = tenantOf(req);
  const body = await branding(req).publicView(tenant);
  res.set('Cache-Control', 'public, max-age=60');
  return body;
}

export async function publicAsset(req: Request, res: Response, kind: PublicAssetKind) {
  const url = await branding(req).signedAssetUrl(kind);
  if (!url) throw notFound('Asset not set');
  // The signed URL lives 5 minutes: the redirect may be cached for less than that.
  res.set('Cache-Control', 'public, max-age=120');
  res.redirect(302, url);
}
