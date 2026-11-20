import type { Services } from '../../core/container.js';

/** 3 to 48 characters: lowercase letters, digits and inner dashes. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

/**
 * Sub-domains that can never be claimed by a tenant (platform, infrastructure, mail, brand
 * impersonation). Compared after normalisation to lowercase.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'admin',
  'administrator',
  'api',
  'app',
  'apps',
  'portal',
  'portail',
  'client',
  'staff',
  'mail',
  'smtp',
  'imap',
  'pop',
  'ftp',
  'ns1',
  'ns2',
  'dns',
  'cdn',
  'static',
  'assets',
  'media',
  'files',
  'status',
  'support',
  'help',
  'aide',
  'docs',
  'doc',
  'blog',
  'billing',
  'payment',
  'payments',
  'pay',
  'login',
  'signin',
  'signup',
  'register',
  'auth',
  'sso',
  'oauth',
  'account',
  'accounts',
  'dashboard',
  'console',
  'root',
  'system',
  'sys',
  'test',
  'tests',
  'demo',
  'staging',
  'preview',
  'dev',
  'prod',
  'production',
  'sandbox',
  'internal',
  'platform',
  'plateforme',
  'hotel',
  'hotels',
  'hotelmanagement',
  'security',
  'abuse',
  'postmaster',
  'webmaster',
  'noreply',
  'no-reply',
  'info',
  'contact',
  'sales',
  'team',
  'about',
  'localhost',
]);

export type SlugReason = 'INVALID' | 'RESERVED' | 'TAKEN';

export interface SlugCheck {
  slug: string;
  available: boolean;
  reason?: SlugReason;
}

/** Format, reserved words, then existing tenant slugs and host names. */
export async function checkSlug(
  services: Pick<Services, 'admin' | 'config'>,
  raw: string,
): Promise<SlugCheck> {
  const slug = raw.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || slug.includes('--'))
    return { slug, available: false, reason: 'INVALID' };
  if (RESERVED_SLUGS.has(slug)) return { slug, available: false, reason: 'RESERVED' };
  const base = baseDomain(services.config);
  const [tenant, domain] = await Promise.all([
    services.admin.tenant.findUnique({ where: { slug }, select: { id: true } }),
    base
      ? services.admin.tenantDomain.findUnique({
          where: { hostname: `${slug}.${base}` },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (tenant || domain) return { slug, available: false, reason: 'TAKEN' };
  return { slug, available: true };
}

/** Base domain of tenant sub-domains: `APP_BASE_DOMAIN`, else the first platform host. */
export function baseDomain(config: Services['config']): string | undefined {
  return config.APP_BASE_DOMAIN || config.PLATFORM_HOSTS[0];
}
