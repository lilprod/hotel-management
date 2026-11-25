import { defineModule } from '../../core/module.js';
import { catalogRouter } from './routes.js';

/** Product catalogue (categories live in the `product_category` lookup list, X6). */
export const catalogModule = defineModule({
  key: 'catalog',
  router: { t: catalogRouter },
  permissions: ['catalog.read', 'settings.read', 'settings.manage'],
  features: ['lodging.core'],
});
export { departmentsModule } from './departments.js';
