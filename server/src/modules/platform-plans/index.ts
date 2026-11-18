import { defineModule } from '../../core/module.js';
import { addonsRouter, couponsRouter, plansRouter } from './routes.js';

export { redeemCoupon } from './service.js';

/** Commercial catalogue of the platform (SA-10…SA-14, EX-01). */
export const platformPlansModule = defineModule({
  key: 'plans',
  router: { admin: plansRouter },
});

export const platformAddonsModule = defineModule({
  key: 'addons',
  router: { admin: addonsRouter },
});

export const platformCouponsModule = defineModule({
  key: 'coupons',
  router: { admin: couponsRouter },
});
