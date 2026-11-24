import { defineModule } from '../../core/module.js';
import { cityLedgerRouter } from './routes.js';

export { listAccounts, statement, settle, aging } from './service.js';

/** City ledger (OP-96, feature `city_ledger`): company accounts, statements, settlements, aging. */
export const cityLedgerModule = defineModule({
  key: 'city-ledger',
  router: { t: cityLedgerRouter },
  permissions: ['city_ledger.read', 'city_ledger.manage'],
  features: ['city_ledger'],
});
