import { defineModule } from '../../core/module.js';
import { FOLIO_EVENTS } from './events.js';
import { businessDateRouter, folioRouter } from './routes.js';
import { folioSettings } from './settings.js';

export { FOLIO_EVENTS } from './events.js';
export { folioSettings } from './settings.js';
export {
  ensureCompanyFolio,
  ensureGroupFolio,
  ensureRoomFolio,
  getFolio,
  postCharge,
  postDiscount,
  postNightsUpTo,
  postNoShowPenalty,
  postRoomNight,
  prepareCheckout,
  resolveFolio,
  reverseLine,
  moveLines,
  setBusinessDate,
  type FCtx,
} from './service.js';
export { recordPayment, recordRefund, reversePayment, renderReceipt } from './payments.js';
export { computeTaxes, convertMinor } from './tax-math.js';

/** Folios (OP-90, OP-91, OP-94): postings, room nights, payments, receipts, check-out support. */
export const folioModule = defineModule({
  key: 'folio',
  basePath: '/folios',
  router: { t: folioRouter },
  permissions: [
    'folio.read',
    'folio.post',
    'folio.pay',
    'folio.discount',
    'folio.reverse',
  ],
  features: ['billing.core', 'city_ledger', 'loyalty'],
  events: [
    { type: FOLIO_EVENTS.changed, realtime: 'property' },
    { type: FOLIO_EVENTS.paymentRecorded },
  ],
  settings: Object.values(folioSettings),
});

/** Property business date (read; admin-only setter until the night audit lot). */
export const businessDateModule = defineModule({
  key: 'business-date',
  router: { t: businessDateRouter },
  permissions: ['folio.read', 'night_audit.run'],
  features: ['billing.core'],
});
