import { defineModule } from '../../core/module.js';
import { FRONT_DESK_EVENTS } from './events.js';
import { frontDeskRouter } from './routes.js';

export { FRONT_DESK_EVENTS } from './events.js';
export { checkIn, walkIn } from './checkin.js';
export { checkOut, previewCheckout } from './checkout.js';
export { resolveStay } from './common.js';

/** Front desk (OP-20…OP-25): day lists, check-in + police record, walk-in, check-out, register. */
export const frontDeskModule = defineModule({
  key: 'front-desk',
  router: { t: frontDeskRouter },
  permissions: [
    'front_desk.read',
    'front_desk.check_in',
    'front_desk.check_out',
    'front_desk.move',
    'front_desk.police_form',
    'front_desk.override_dirty',
    'front_desk.checkout_with_balance',
  ],
  features: ['lodging.core'],
  events: [
    { type: FRONT_DESK_EVENTS.checkedIn, realtime: 'property' },
    { type: FRONT_DESK_EVENTS.checkedOut, realtime: 'property' },
    { type: FRONT_DESK_EVENTS.roomChanged, realtime: 'property' },
  ],
});
