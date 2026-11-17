import { coreModule } from '../core/core-module.js';
import type { ModuleDefinition } from '../core/module.js';
import { brandingModule, brandingPublicModule } from './branding/index.js';
import { catalogModule } from './catalog/index.js';
import { customFieldsModule } from './custom-fields/index.js';
import { lookupsModule } from './lookups/index.js';
import { notificationsModule } from './notifications/index.js';
import { propertyModule } from './property/index.js';
import { ratesModule } from './rates/index.js';
import { sequencesModule } from './sequences/index.js';
import { systemModule } from './system/index.js';

/** Modules loaded by the server and the worker. Business modules are appended by later lots. */
export const MODULES: readonly ModuleDefinition[] = [
  coreModule,
  systemModule,
  brandingModule,
  brandingPublicModule,
  propertyModule,
  ratesModule,
  catalogModule,
  lookupsModule,
  customFieldsModule,
  sequencesModule,
  notificationsModule,
];
