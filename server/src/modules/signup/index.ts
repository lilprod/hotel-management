import { defineModule } from '../../core/module.js';
import { signupRouter } from './routes.js';

export { setCaptchaVerifier, type CaptchaVerifier } from './captcha.js';
export { checkSlug, RESERVED_SLUGS } from './slug.js';

/** Public API `/api/v1/public`: plans, slug availability, self-service signup (TN-01…TN-03). */
export const signupModule = defineModule({
  key: 'public-signup',
  basePath: '',
  auth: 'optional',
  router: { public: signupRouter },
});
