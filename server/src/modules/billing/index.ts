import { defineModule } from '../../core/module.js';
import { billingRemindersJob, subscriptionLifecycleJob } from './lifecycle.js';
import {
  billingAdminRouter,
  declarationsRouter,
  invoicesRouter,
  paymentsRouter,
} from './routes.js';

export { BILLING_EVENTS, setBillingClock, type Actor } from './common.js';
export { overrideBillingNotifier, type BillingNotice } from './notifier.js';
export {
  runLifecycle,
  runReminders,
  subscriptionLifecycleJob,
  billingRemindersJob,
} from './lifecycle.js';
export { nextPlatformNumber } from './numbering.js';
export { recordPayment, reversePayment, validatePayment } from './payments.js';
export { changePlan, startSubscription } from './management.js';
export * as billingDomain from './domain.js';
export * as subscriptionMachine from './state-machine.js';

/** SaaS billing: manual payments (FINANCE / SUPER_ADMIN), `/api/v1/admin/payments`. */
export const paymentsModule = defineModule({
  key: 'payments',
  router: { admin: paymentsRouter },
  // Daily lifecycle + reminders (repeatable BullMQ jobs on the `billing` queue).
  jobs: [subscriptionLifecycleJob, billingRemindersJob],
});

/** Platform invoices `PLT-YYYY-NNNNNN`, `/api/v1/admin/invoices`. */
export const platformInvoicesModule = defineModule({
  key: 'platform-invoices',
  basePath: '/invoices',
  router: { admin: invoicesRouter },
});

/** Tenant payment declarations queue (SA-36), `/api/v1/admin/declarations`. */
export const declarationsModule = defineModule({
  key: 'payment-declarations',
  basePath: '/declarations',
  router: { admin: declarationsRouter },
});

/** Billing settings and reports, `/api/v1/admin/billing`. */
export const billingAdminModule = defineModule({
  key: 'billing-admin',
  basePath: '/billing',
  router: { admin: billingAdminRouter },
});

export const BILLING_MODULES = [
  paymentsModule,
  platformInvoicesModule,
  declarationsModule,
  billingAdminModule,
] as const;
