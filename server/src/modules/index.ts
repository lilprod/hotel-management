import { coreModule } from '../core/core-module.js';
import type { ModuleDefinition } from '../core/module.js';
import { auditModule } from './audit/index.js';
import { authModule } from './auth/index.js';
import { brandingModule, brandingPublicModule } from './branding/index.js';
import { catalogModule } from './catalog/index.js';
import { customFieldsModule } from './custom-fields/index.js';
import { iamModule } from './iam/index.js';
import { legalModule } from './legal/index.js';
import { lookupsModule } from './lookups/index.js';
import { notificationsModule } from './notifications/index.js';
import {
  impersonationModule,
  platformAuthModule,
  platformUsersModule,
} from './platform-auth/index.js';
import { portalAuthModule } from './portal-auth/index.js';
import { propertyModule } from './property/index.js';
import { ratesModule } from './rates/index.js';
import { sequencesModule } from './sequences/index.js';
import { systemModule } from './system/index.js';

/** Modules loaded by the server and the worker. Business modules are appended by later lots. */
export const MODULES: readonly ModuleDefinition[] = [
  coreModule,
  systemModule,
  authModule,
  legalModule,
  iamModule,
  auditModule,
  platformAuthModule,
  platformUsersModule,
  impersonationModule,
  portalAuthModule,
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
