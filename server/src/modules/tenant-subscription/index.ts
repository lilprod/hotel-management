import { defineModule } from '../../core/module.js';
import { tenantSubscriptionRouter } from './routes.js';

/**
 * Tenant subscription page (TN-30…TN-34) on the staff surface `/api/v1/t/billing`. Not gated by
 * a plan feature: every tenant must be able to see and pay its subscription.
 */
export const tenantSubscriptionModule = defineModule({
  key: 'tenant-subscription',
  basePath: '/billing',
  permissions: ['billing.manage'],
  router: { t: tenantSubscriptionRouter },
});
