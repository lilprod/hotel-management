import { requireTenantId } from '@hm/database';
import type { Branding } from '@hm/templates';
import type { Services } from '../../core/container.js';
import { legalOf, profileOf } from '../branding/schemas.js';
import { notificationDeps } from './deps.js';

export interface TenantMessaging {
  branding: Partial<Branding>;
  /** Display name used as e-mail sender. */
  senderName: string;
  defaultLocale: string;
  replyTo?: string;
}

const MAX_LOGO_BYTES = 512 * 1024;

/** Logo as an inline data URI (signed URLs expire after 5 minutes, e-mails live longer). */
async function logoDataUri(services: Services, fileId: string): Promise<string | undefined> {
  try {
    const file = await services.db.file.findFirst({
      where: { id: fileId, tenantId: requireTenantId() },
      select: { key: true, mime: true, size: true },
    });
    if (!file || Number(file.size) > MAX_LOGO_BYTES) return undefined;
    const { storage, fetch: f } = notificationDeps(services);
    const res = await f(await storage.signedUrl(file.key), { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${file.mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    services.logger.warn('logo unavailable for notification', { err: (err as Error).message });
    return undefined;
  }
}

/** Branding, legal footer, sender name and default locale of a tenant (call inside its context). */
export async function loadTenantMessaging(
  services: Services,
  tenantId: string,
): Promise<TenantMessaging> {
  const [tenant, row] = await Promise.all([
    services.admin.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, defaultLocale: true, email: true },
    }),
    services.db.branding.findFirst({ where: { tenantId } }),
  ]);
  const legal = legalOf(row);
  const profile = profileOf(row);
  const name = tenant?.name ?? 'Hotel';
  const footerLegal = [
    row?.docFooter,
    [legal.nif && `NIF : ${legal.nif}`, legal.rccm && `RCCM : ${legal.rccm}`]
      .filter(Boolean)
      .join(' - '),
    row?.legalMentions,
    legal.address,
  ]
    .filter((l): l is string => !!l)
    .flatMap((l) => l.split(/\r?\n/));
  const logoUrl = row?.logoFileId ? await logoDataUri(services, row.logoFileId) : undefined;
  const replyTo = profile.contact.email ?? tenant?.email ?? undefined;
  return {
    branding: {
      displayName: name,
      ...(logoUrl ? { logoUrl } : {}),
      ...(row?.primaryColor ? { primaryColor: row.primaryColor } : {}),
      ...(row?.secondaryColor ? { accentColor: row.secondaryColor } : {}),
      footerLegal,
    },
    senderName: row?.emailSenderName ?? name,
    defaultLocale: profile.languages[0] ?? tenant?.defaultLocale ?? 'fr',
    ...(replyTo ? { replyTo } : {}),
  };
}
