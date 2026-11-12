import { coreModule } from '../core/core-module.js';
import type { ModuleDefinition } from '../core/module.js';
import { systemModule } from './system/index.js';

/** Modules loaded by the server and the worker. Business modules are appended by later lots. */
export const MODULES: readonly ModuleDefinition[] = [coreModule, systemModule];
