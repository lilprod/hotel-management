import { createModuleRouter } from '../../core/router.js';
import { anyStaff } from '../../http/helpers.js';
import { getWhoami } from './controller.js';
import { whoamiResponseSchema } from './schemas.js';

export const systemRouter = createModuleRouter().route({
  method: 'get',
  path: '/whoami',
  summary: 'Current staff user, tenant, permissions and entitlements',
  // Open to every authenticated staff member: explicit opt-out of can().
  middleware: [anyStaff()],
  responses: { 200: { description: 'Caller identity', schema: whoamiResponseSchema } },
  handler: (req) => getWhoami(req),
});
