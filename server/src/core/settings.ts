import { runWithTenant, type AppClient, type Prisma } from '@hm/database';
import type { z } from 'zod';
import type { Logger } from '../lib/logger.js';

export type SettingScope = 'PLATFORM' | 'TENANT' | 'PROPERTY' | 'USER';

/** A setting declared by a module: key, Zod schema, default, and scopes where it may be set. */
export interface SettingDefinition<T = unknown> {
  key: string;
  schema: z.ZodType<T>;
  default: T;
  scopes?: readonly SettingScope[];
  description?: string;
}

export function defineSetting<T>(def: SettingDefinition<T>): SettingDefinition<T> {
  const parsed = def.schema.safeParse(def.default);
  if (!parsed.success) throw new Error(`Setting ${def.key}: default does not match its schema`);
  return Object.freeze({ scopes: ['PLATFORM', 'TENANT', 'PROPERTY', 'USER'] as const, ...def });
}

export interface SettingLookup {
  tenantId: string;
  propertyId?: string | undefined;
  userId?: string | undefined;
}

const PRECEDENCE: Record<SettingScope, number> = { USER: 0, PROPERTY: 1, TENANT: 2, PLATFORM: 3 };

export class SettingsRegistry {
  private readonly defs = new Map<string, SettingDefinition>();

  register(def: SettingDefinition): void {
    if (this.defs.has(def.key)) throw new Error(`Setting ${def.key} is declared twice`);
    this.defs.set(def.key, def);
  }

  get(key: string): SettingDefinition {
    const def = this.defs.get(key);
    if (!def) throw new Error(`Unknown setting ${key}`);
    return def;
  }

  list(): SettingDefinition[] {
    return [...this.defs.values()];
  }
}

/**
 * Hierarchical settings (doc 03 §5 bis X4): USER > PROPERTY > TENANT > PLATFORM > default.
 * Reads go through the RLS-bound app client (tenant rows + platform defaults only).
 * Stored values failing the schema are ignored (logged) and resolution falls through.
 */
export class SettingsService {
  constructor(
    private readonly db: AppClient,
    readonly registry: SettingsRegistry,
    private readonly logger: Logger,
  ) {}

  get<T>(def: SettingDefinition<T>, at: SettingLookup): Promise<T>;
  get(key: string, at: SettingLookup): Promise<unknown>;
  async get(keyOrDef: string | SettingDefinition, at: SettingLookup): Promise<unknown> {
    const def = typeof keyOrDef === 'string' ? this.registry.get(keyOrDef) : keyOrDef;
    const or: Prisma.SettingWhereInput[] = [
      { scope: 'TENANT', scopeId: at.tenantId },
      { scope: 'PLATFORM', tenantId: null },
    ];
    if (at.propertyId) or.push({ scope: 'PROPERTY', scopeId: at.propertyId });
    if (at.userId) or.push({ scope: 'USER', scopeId: at.userId });

    const rows = await runWithTenant(at.tenantId, () =>
      this.db.setting.findMany({
        where: { key: def.key, OR: or },
        select: { scope: true, value: true },
      }),
    );
    rows.sort((a, b) => PRECEDENCE[a.scope] - PRECEDENCE[b.scope]);
    for (const row of rows) {
      const parsed = def.schema.safeParse(row.value);
      if (parsed.success) return parsed.data;
      this.logger.warn('setting value ignored: schema mismatch', {
        key: def.key,
        scope: row.scope,
      });
    }
    return def.default;
  }

  /** Upserts a tenant-, property- or user-level value (validated against the schema). */
  async set<T>(
    def: SettingDefinition<T>,
    value: T,
    target: { tenantId: string; scope: Exclude<SettingScope, 'PLATFORM'>; scopeId?: string },
  ): Promise<void> {
    if (def.scopes && !def.scopes.includes(target.scope))
      throw new Error(`Setting ${def.key} cannot be set at scope ${target.scope}`);
    const parsed = def.schema.parse(value) as Prisma.InputJsonValue;
    const scopeId = target.scope === 'TENANT' ? target.tenantId : target.scopeId;
    if (!scopeId) throw new Error(`scopeId is required for scope ${target.scope}`);
    await runWithTenant(target.tenantId, () =>
      this.db.setting.upsert({
        where: { scope_scopeId_key: { scope: target.scope, scopeId, key: def.key } },
        create: {
          tenantId: target.tenantId,
          scope: target.scope,
          scopeId,
          key: def.key,
          value: parsed,
        },
        update: { value: parsed },
      }),
    );
  }
}
