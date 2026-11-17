import { defineModule } from '../../core/module.js';
import { propertyRouter } from './routes.js';

export { withCtx, assertPropertyAccess, type Ctx } from './common.js';

/** Lodging setup: properties, room types (+ photos), rooms (+ bulk), room blocks. */
export const propertyModule = defineModule({
  key: 'property',
  basePath: '/lodging',
  router: { t: propertyRouter },
  permissions: ['lodging.read', 'lodging.manage', 'settings.manage'],
  features: ['lodging.core'],
});
