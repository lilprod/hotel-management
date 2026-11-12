import type { Services } from '../../core/container.js';
import type { UserGrants } from '../../core/permissions.js';
import type { ResolvedTenant } from '../../core/tenants.js';
import type { WhoamiResponse } from './schemas.js';

/** Identity of the caller, built only from the resolved tenant and RLS-scoped grants. */
export async function whoami(
  services: Services,
  tenant: ResolvedTenant,
  grants: UserGrants,
): Promise<WhoamiResponse> {
  const [entitlements, status] = await Promise.all([
    services.entitlements.resolve(tenant.id),
    services.tenants.subscriptionStatus(tenant.id),
  ]);
  return {
    user: { id: grants.userId, name: grants.name, email: grants.email },
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    permissions: grants.permissions,
    propertyIds: grants.propertyIds,
    subscription: { status },
    entitlements: {
      planCode: entitlements.planCode,
      features: entitlements.features,
      quotas: entitlements.quotas,
    },
  };
}
