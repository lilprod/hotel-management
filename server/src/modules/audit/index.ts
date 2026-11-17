import { defineModule } from '../../core/module.js';
import { auditRouter, platformAuditRouter } from './routes.js';

export { recordAudit } from '../../middleware/audit.js';
export { auditNow, diffJson, sanitize, writePlatformAudit, writeTenantAudit } from './service.js';

/** Immutable audit trails: tenant (`audit_logs`) and platform (`platform_audit_logs`). */
export const auditModule = defineModule({
  key: 'audit',
  router: { t: auditRouter, admin: platformAuditRouter },
  permissions: ['audit.read', 'audit.export'],
});
