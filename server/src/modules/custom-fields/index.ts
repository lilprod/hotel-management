import { defineModule } from '../../core/module.js';
import { customFieldsRouter } from './routes.js';

export {
  buildCustomFieldsSchema,
  parseCustomFields,
  validateCustomFields,
  type BuildOptions,
  type CustomFieldRule,
} from './validation.js';
export { CUSTOM_FIELD_ENTITIES, type CustomFieldEntity } from './schemas.js';

/** Custom fields (doc 08 X5): definitions CRUD + dynamic validation helper for other modules. */
export const customFieldsModule = defineModule({
  key: 'custom-fields',
  router: { t: customFieldsRouter },
  permissions: ['settings.read', 'settings.manage'],
  features: ['lodging.core'],
});
