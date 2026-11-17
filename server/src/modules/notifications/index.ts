import { defineModule } from '../../core/module.js';
import { deliverJob, pdfRenderJob } from './jobs.js';
import { notificationSettings } from './settings.js';

export { overrideNotificationDeps } from './deps.js';
export { createNotifier, notify, NOTIFY_CHANNELS } from './service.js';
export type { NotifyInput, NotifyResult, NotifyChannel, Notifier, Recipient } from './service.js';
export { renderPdf, enqueuePdf, deliverJob, pdfRenderJob } from './jobs.js';
export type { RenderPdfInput, RenderedPdf } from './jobs.js';
export { notificationSettings } from './settings.js';

/** Notification pipeline (e-mail / SMS / WhatsApp / in-app) and PDF rendering workers. */
export const notificationsModule = defineModule({
  key: 'notifications',
  jobs: [deliverJob, pdfRenderJob],
  settings: Object.values(notificationSettings),
});
