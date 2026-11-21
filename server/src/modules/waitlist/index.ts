import { defineModule } from '../../core/module.js';
import { RESERVATION_EVENTS } from '../reservations/events.js';
import { onInventoryReleased, waitlistMatchJob } from './jobs.js';
import { waitlistRouter } from './routes.js';

export { matchWaitlist, acceptOffer, createEntry, WAITLIST_OFFER_TEMPLATE } from './service.js';
export { waitlistMatchJob, onInventoryReleased } from './jobs.js';

/** Waitlist (OP-15): entries, offers on `inventory.released`, accept → reservation. */
export const waitlistModule = defineModule({
  key: 'waitlist',
  router: { t: waitlistRouter },
  permissions: ['waitlist.read', 'waitlist.manage'],
  features: ['lodging.core'],
  jobs: [waitlistMatchJob],
  events: [
    { type: RESERVATION_EVENTS.inventoryReleased, handler: onInventoryReleased },
    { type: RESERVATION_EVENTS.waitlistOffered, realtime: 'property' },
  ],
});
