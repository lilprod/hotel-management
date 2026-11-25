import { defineModule } from '../../core/module.js';
import { NIGHT_AUDIT_EVENTS } from './events.js';
import { nightAuditCheckJob } from './jobs.js';
import { nightAuditRouter } from './routes.js';
import { nightAuditSettings } from './settings.js';

export { NIGHT_AUDIT_EVENTS } from './events.js';
export { nightAuditSettings } from './settings.js';
export { precheck } from './precheck.js';
export { runNightAudit, listAudits, getAudit, auditReport, setNightAuditFault, STEPS } from './service.js';
export { runNightAuditCheck, nightAuditCheckJob, dueAt } from './jobs.js';

/** Night audit (OP-24): pre-checks, nights, no-shows, daily stats (X13), closing, day report. */
export const nightAuditModule = defineModule({
  key: 'night-audit',
  router: { t: nightAuditRouter },
  permissions: ['night_audit.read', 'night_audit.run'],
  features: ['billing.core'],
  jobs: [nightAuditCheckJob],
  events: [
    { type: NIGHT_AUDIT_EVENTS.completed, realtime: 'property' },
    { type: NIGHT_AUDIT_EVENTS.failed, realtime: 'property' },
  ],
  settings: Object.values(nightAuditSettings),
});
