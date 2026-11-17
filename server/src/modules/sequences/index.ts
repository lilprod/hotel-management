import { defineModule } from '../../core/module.js';

export {
  formatSequence,
  nextSequence,
  nextSequenceStandalone,
  peekSequence,
  sequenceScope,
  type NextSequenceOptions,
} from './service.js';

/** Gap-free numbering service (no HTTP surface): consumed by reservations, invoicing, cash. */
export const sequencesModule = defineModule({ key: 'sequences' });
