import { defineModule } from '../../core/module.js';
import { portalAuthRouter } from './routes.js';

export { GUEST_VERIFICATION_TEMPLATE } from './service.js';

/** Guest accounts authentication on the portal surface. */
export const portalAuthModule = defineModule({
  key: 'portal-auth',
  basePath: '/auth',
  auth: 'optional',
  router: { portal: portalAuthRouter },
});
