import type { Router } from 'express';
import type { Surface } from '../http/types.js';
import type { AnyJobDefinition } from '../jobs/context.js';
import type { ModuleRouter } from './router.js';
import { SettingsRegistry, type SettingDefinition } from './settings.js';
import type { Services } from './container.js';

/** Realtime fan-out of a domain event relayed from the outbox. */
export type RealtimeTarget =
  /** Staff room `t:{tid}`. */
  | 'tenant'
  /** `t:{tid}:u:{payload.userId}`. */
  | 'user'
  /** `t:{tid}:p:{payload.propertyId}`. */
  | 'property';

export interface DomainEvent {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

export interface EventDefinition {
  type: string;
  /** Emit the event to Socket.io rooms when relayed. */
  realtime?: RealtimeTarget;
  /** In-process handler, run by the `domain-events` worker inside runWithTenant(event.tenantId). */
  handler?: (event: DomainEvent, services: Services) => Promise<void> | void;
}

export type ModuleRouters = Partial<Record<Surface, ModuleRouter | Router>>;

export interface ModuleDefinition {
  key: string;
  /** Mount point under each surface prefix (default `/${key}`). */
  basePath?: string;
  /** A single router (mounted on the staff surface `/api/v1/t`) or one router per surface. */
  router?: ModuleRouter | Router | ModuleRouters;
  /** `required` (default): every route needs a token of the surface's scope. */
  auth?: 'required' | 'optional';
  /** Permissions introduced by the module (documentation / role editor). */
  permissions?: readonly string[];
  /** Feature keys the module is gated by (documentation / sidebar). */
  features?: readonly string[];
  jobs?: readonly AnyJobDefinition[];
  events?: readonly EventDefinition[];
  settings?: readonly SettingDefinition[];
}

const KEY_RE = /^[a-z][a-z0-9_-]*$/;

export function defineModule<const M extends ModuleDefinition>(def: M): M {
  if (!KEY_RE.test(def.key)) throw new Error(`Invalid module key ${def.key}`);
  return Object.freeze(def);
}

export interface MountedRouter {
  module: ModuleDefinition;
  surface: Surface;
  basePath: string;
  router: ModuleRouter | Router;
}

function isRouterLike(r: unknown): r is ModuleRouter | Router {
  return (
    typeof r === 'function' ||
    (typeof r === 'object' && r !== null && 'router' in r && 'routes' in r)
  );
}

/** Registry of the loaded modules: routers per surface, jobs, events and settings. */
export class ModuleRegistry {
  readonly modules: readonly ModuleDefinition[];
  readonly settings = new SettingsRegistry();

  constructor(modules: readonly ModuleDefinition[]) {
    const seen = new Set<string>();
    for (const m of modules) {
      if (seen.has(m.key)) throw new Error(`Module ${m.key} is registered twice`);
      seen.add(m.key);
      for (const s of m.settings ?? []) this.settings.register(s);
    }
    this.modules = modules;
  }

  routers(): MountedRouter[] {
    const out: MountedRouter[] = [];
    for (const m of this.modules) {
      if (!m.router) continue;
      const basePath = m.basePath ?? `/${m.key}`;
      const routers: ModuleRouters = isRouterLike(m.router) ? { t: m.router } : m.router;
      for (const [surface, router] of Object.entries(routers) as [
        Surface,
        ModuleRouter | Router,
      ][]) {
        if (router) out.push({ module: m, surface, basePath, router });
      }
    }
    return out;
  }

  jobs(): AnyJobDefinition[] {
    return this.modules.flatMap((m) => [...(m.jobs ?? [])]);
  }

  events(type?: string): EventDefinition[] {
    const all = this.modules.flatMap((m) => [...(m.events ?? [])]);
    return type ? all.filter((e) => e.type === type) : all;
  }

  /** First realtime target declared for an event type, if any. */
  realtimeTarget(type: string): RealtimeTarget | undefined {
    return this.events(type).find((e) => e.realtime)?.realtime;
  }
}
