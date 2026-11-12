import { providerSettings } from '../lib/providers/index.js';
import { CORE_EVENTS } from './events.js';
import { defineModule } from './module.js';

/** Core settings (adapter selection) and cache invalidation on platform events. */
export const coreModule = defineModule({
  key: 'core',
  settings: Object.values(providerSettings),
  events: [
    {
      type: CORE_EVENTS.entitlementsChanged,
      handler: (event, services) => services.entitlements.invalidate(event.tenantId),
    },
    {
      type: CORE_EVENTS.subscriptionChanged,
      handler: async (event, services) => {
        await services.tenants.invalidateTenant(event.tenantId);
        await services.entitlements.invalidate(event.tenantId);
      },
    },
    {
      type: CORE_EVENTS.tenantDomainsChanged,
      handler: (event, services) => services.tenants.invalidateTenant(event.tenantId),
    },
  ],
});
