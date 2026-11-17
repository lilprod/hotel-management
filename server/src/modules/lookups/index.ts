import { defineModule } from '../../core/module.js';
import { lookupsRouter } from './routes.js';

export { requireLookupCode } from './service.js';
export { KNOWN_LIST_KEYS, PRODUCT_CATEGORY_LIST } from './schemas.js';

/** Configurable lists (doc 08 X6): per-tenant reference tables, not enums. */
export const lookupsModule = defineModule({
  key: 'lookups',
  router: { t: lookupsRouter },
  permissions: ['settings.read', 'settings.manage'],
  features: ['lodging.core'],
});
