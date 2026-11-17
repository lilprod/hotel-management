import { defineModule } from '../../core/module.js';
import { impersonationRouter, platformAuthRouter, platformUsersRouter } from './routes.js';

export { PLATFORM_ROLES, platformRole } from '../../middleware/platform-guard.js';

/** Platform authentication (TOTP mandatory) on `/api/v1/admin/auth`. */
export const platformAuthModule = defineModule({
  key: 'platform-auth',
  basePath: '/auth',
  auth: 'optional',
  router: { admin: platformAuthRouter },
});

/** Platform users CRUD (SUPER_ADMIN). */
export const platformUsersModule = defineModule({
  key: 'platform-users',
  router: { admin: platformUsersRouter },
});

/** Support impersonation of consenting tenants. */
export const impersonationModule = defineModule({
  key: 'impersonations',
  router: { admin: impersonationRouter },
});
