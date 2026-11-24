import { defineModule } from '../../core/module.js';
import { FOLIO_EVENTS } from '../folio/events.js';
import { cashRouter, ratesRouter } from './routes.js';

export { openSessionOf, computeTotals } from './service.js';
export { rateFor } from './exchange-rates.js';

/** Cash sessions (OP-93): float, movements, expected per tender, close with count, X/Z reports. */
export const cashierModule = defineModule({
  key: 'cashier',
  basePath: '/cash-sessions',
  router: { t: cashRouter },
  permissions: [
    'cash.read',
    'cash.session',
    'cash.movements',
    'cash.close',
    'cash.close_with_variance',
  ],
  features: ['billing.core'],
  events: [{ type: FOLIO_EVENTS.cashSessionClosed }],
});

/** Daily exchange rates for multi-currency tenders (EX-21). */
export const exchangeRatesModule = defineModule({
  key: 'exchange-rates',
  router: { t: ratesRouter },
  permissions: ['folio.read', 'settings.manage'],
  features: ['billing.core'],
});
