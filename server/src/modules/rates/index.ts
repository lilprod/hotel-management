import { defineModule } from '../../core/module.js';
import { ratesRouter } from './routes.js';

export { priceStay, stayNights, QuoteError } from './quote.js';
export type { Quote, QuoteData, QuoteInput } from './quote.js';
export { quoteStay } from './service.js';

/** Pricing setup: rate plans, seasons, rates, taxes, policies and the stay price calculator. */
export const ratesModule = defineModule({
  key: 'rates',
  basePath: '/pricing',
  router: { t: ratesRouter },
  permissions: ['lodging.read', 'lodging.manage', 'settings.read', 'settings.manage'],
  features: ['lodging.core'],
});
