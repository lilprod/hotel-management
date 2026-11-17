import { defineModule } from '../../core/module.js';
import { legalRouter } from './routes.js';

export { invalidateLegalCache, latestDocuments, pendingDocuments } from './service.js';

/** TOS / DPA acceptance gate (doc 08 EX-04). */
export const legalModule = defineModule({ key: 'legal', router: { t: legalRouter } });
