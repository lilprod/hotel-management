import { defineModule } from '../../core/module.js';
import { availabilityRouter, planningRouter } from './routes.js';

export * from './inventory.js';
export { loadPricing, quoteLine } from './pricing.js';
export { searchAvailability, planning } from './service.js';

/** Availability search `GET /api/v1/t/availability` (OP-11). */
export const availabilityModule = defineModule({
  key: 'availability',
  router: { t: availabilityRouter },
  permissions: ['reservations.read'],
  features: ['lodging.core'],
});

/** Planning grid `GET /api/v1/t/planning` (OP-10, live through `planning.changed`). */
export const planningModule = defineModule({
  key: 'planning',
  router: { t: planningRouter },
  permissions: ['reservations.read'],
  features: ['lodging.core'],
});
