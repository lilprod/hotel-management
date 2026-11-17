import { defineModule } from '../../core/module.js';
import { iamRouter } from './routes.js';

export { isValidPermissionKey } from './service.js';
export {
  assertPropertyAccess,
  canReachProperty,
  filterReachable,
  propertyFrom,
  propertyScope,
  propertyWhere,
} from '../../core/property-scope.js';

/** Users, roles, permissions and security policy of a tenant. */
export const iamModule = defineModule({
  key: 'iam',
  router: { t: iamRouter },
  permissions: [
    'users.read',
    'users.manage',
    'roles.read',
    'roles.manage',
    'security.read',
    'security.manage',
  ],
  features: ['security.custom_roles', 'security.ip_restriction'],
});
