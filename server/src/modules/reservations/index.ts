import { defineModule } from '../../core/module.js';
import { RESERVATION_EVENTS } from './events.js';
import { groupsRouter } from './groups-routes.js';
import { bookingRemindersJob, pendingExpiryJob } from './jobs.js';
import { reservationsRouter } from './routes.js';
import { reservationSettings } from './settings.js';

export {
  closeReservationQueues,
  overrideGuestNotifier,
  setReservationsClock,
  systemCtx,
  runSystem,
  type RCtx,
} from './context.js';
export { RESERVATION_EVENTS } from './events.js';
export * as reservationLifecycle from './lifecycle.js';
export { guardTransition, computePenalty, TRANSITIONS } from './lifecycle.js';
export {
  runPendingExpiry,
  runBookingReminders,
  pendingExpiryJob,
  bookingRemindersJob,
} from './jobs.js';
export { reservationSettings } from './settings.js';

/** Reservation engine (OP-10…OP-16): dossiers, assignment, lifecycle, penalties, reminders. */
export const reservationsModule = defineModule({
  key: 'reservations',
  router: { t: reservationsRouter },
  permissions: [
    'reservations.read',
    'reservations.create',
    'reservations.update',
    'reservations.cancel',
    'reservations.assign',
  ],
  features: ['lodging.core'],
  jobs: [pendingExpiryJob, bookingRemindersJob],
  events: [
    { type: RESERVATION_EVENTS.planningChanged, realtime: 'property' },
    { type: RESERVATION_EVENTS.inventoryReleased },
    { type: RESERVATION_EVENTS.created },
    { type: RESERVATION_EVENTS.updated },
    { type: RESERVATION_EVENTS.confirmed },
    { type: RESERVATION_EVENTS.cancelled },
    { type: RESERVATION_EVENTS.noShow },
  ],
  settings: Object.values(reservationSettings),
});

/** Groups (OP-17, feature `groups`): allotment, rooming list, pick-up, release. */
export const groupsModule = defineModule({
  key: 'groups',
  router: { t: groupsRouter },
  permissions: ['groups.read', 'groups.manage'],
  features: ['groups'],
});
