import { defineModule } from '../../core/module.js';
import { brandingRouter, publicBrandingRouter } from './routes.js';
import { brandingSettings } from './schemas.js';

export { overrideBrandingDeps } from './deps.js';
export type { BrandingStorage, DnsTxtResolver } from './deps.js';

/** Staff API `/api/v1/t/branding`: colours, assets, legal mentions, message templates, domain. */
export const brandingModule = defineModule({
  key: 'branding',
  router: { t: brandingRouter },
  permissions: ['branding.read', 'branding.manage'],
  features: ['branding.custom_domain'],
  settings: Object.values(brandingSettings),
});

/** Public portal API `/api/v1/portal/branding` (no auth: the tenant comes from the Host). */
export const brandingPublicModule = defineModule({
  key: 'branding-public',
  basePath: '/branding',
  auth: 'optional',
  router: { portal: publicBrandingRouter },
});
