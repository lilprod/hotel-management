import { defineModule } from '../../core/module.js';
import { onboardingRouter } from './routes.js';
import { onboardingSettings } from './settings.js';

/** Setup wizard state and demonstration data of the tenant owner (TN-02, TN-03). */
export const onboardingModule = defineModule({
  key: 'onboarding',
  router: { t: onboardingRouter },
  settings: Object.values(onboardingSettings),
  features: ['lodging.core'],
});
