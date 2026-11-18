import { defineModule } from '../../core/module.js';
import { tenantsRouter } from './routes.js';

export { exportTenant } from './export.js';
export { buildZip } from './zip.js';

/** Tenants administration (SA-20…SA-26) on `/api/v1/admin/tenants`. */
export const platformTenantsModule = defineModule({
  key: 'tenants',
  router: { admin: tenantsRouter },
});
