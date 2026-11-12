import { defineModule } from '../../core/module.js';
import { systemRouter } from './routes.js';

/** Example module proving the chain tenant → auth → subscription → permission → handler. */
export const systemModule = defineModule({
  key: 'system',
  router: { t: systemRouter },
});
