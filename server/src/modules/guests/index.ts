import { defineModule } from '../../core/module.js';
import { guestsRouter } from './routes.js';

export { insertGuest, loadGuest, toGuest } from './service.js';
export { encryptIdNumber, decryptIdNumber } from './crypto.js';

/** Guest profiles needed by the reservation engine (search, create, update, blacklist). */
export const guestsModule = defineModule({
  key: 'guests',
  router: { t: guestsRouter },
  permissions: ['guests.read', 'guests.create', 'guests.update'],
  features: ['lodging.core'],
});
