import { defineModule } from '../../core/module.js';
import { authRouter } from './routes.js';

export { overrideAuthMailer, sendAuthMessage } from './mailer.js';
export type { AuthMailer, AuthMessage } from './mailer.js';
export { generateTotp } from './totp.js';

/** Staff authentication (login, MFA, refresh rotation, passwords, sessions, invitations). */
export const authModule = defineModule({
  key: 'auth',
  auth: 'optional',
  router: { t: authRouter },
});
