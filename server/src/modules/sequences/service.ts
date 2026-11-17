import { randomUUID } from 'node:crypto';
import { requireTenantId, type AppClient, type TransactionClient } from '@hm/database';
import { AppError } from '../../lib/errors.js';

const KEY_RE = /^[a-z][a-z0-9_.-]{0,63}$/;

/** Scope of a per-property counter: `<tenant_id>:<property_id>` (doc 04, table `sequences`). */
export function sequenceScope(tenantId: string, propertyId: string): string {
  return `${tenantId}:${propertyId}`;
}

export interface NextSequenceOptions {
  /** Counter year (0 = never reset). Use the business year for yearly numbering. */
  year?: number;
}

/**
 * Gap-free counter (OP-08): returns the next value of `(scope, key, year)` and advances it.
 *
 * MUST run inside the transaction that issues the document (`db.$transaction(tx => ...)`): the
 * row is locked with `SELECT … FOR UPDATE` until that transaction ends, so concurrent issuers
 * are serialised and a rollback gives the number back (no hole). Never call it on the bare
 * client: the lock would be released between statements.
 *
 * The scope must belong to the current tenant (`<tenant_id>:…`); the tenant id comes from the
 * RLS context, never from the caller.
 */
export async function nextSequence(
  tx: TransactionClient,
  scope: string,
  key: string,
  opts: NextSequenceOptions = {},
): Promise<number> {
  const tenantId = requireTenantId();
  const year = opts.year ?? 0;
  if (!scope.startsWith(`${tenantId}:`))
    throw new AppError('FORBIDDEN', undefined, { detail: 'Sequence scope of another tenant' });
  if (!KEY_RE.test(key)) throw new AppError('BAD_REQUEST', 'Invalid sequence key');
  if (!Number.isInteger(year) || year < 0 || year > 9999)
    throw new AppError('BAD_REQUEST', 'Invalid sequence year');

  // Row creation is idempotent and race-free (a concurrent insert blocks, then does nothing).
  await tx.$executeRaw`
    INSERT INTO sequences (id, tenant_id, scope, key, year, next_value, updated_at)
    VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${scope}, ${key}, ${year}, 1, now())
    ON CONFLICT (scope, key, year) DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; next_value: bigint }[]>`
    SELECT id, next_value FROM sequences
    WHERE scope = ${scope} AND key = ${key} AND year = ${year}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppError('INTERNAL_ERROR', 'Sequence row not found');
  await tx.$executeRaw`
    UPDATE sequences SET next_value = next_value + 1, updated_at = now() WHERE id = ${row.id}::uuid`;
  return Number(row.next_value);
}

/**
 * Convenience wrapper opening its own transaction (tests, one-off numbering). A document issuer
 * must instead pass its own `tx` to {@link nextSequence} so the number and the document commit
 * or roll back together.
 */
export function nextSequenceStandalone(
  db: AppClient,
  scope: string,
  key: string,
  opts: NextSequenceOptions = {},
): Promise<number> {
  return db.$transaction((tx) => nextSequence(tx, scope, key, opts));
}

/** Current value that the next call will return, without consuming it. */
export async function peekSequence(
  tx: TransactionClient,
  scope: string,
  key: string,
  opts: NextSequenceOptions = {},
): Promise<number> {
  const rows = await tx.$queryRaw<{ next_value: bigint }[]>`
    SELECT next_value FROM sequences
    WHERE scope = ${scope} AND key = ${key} AND year = ${opts.year ?? 0}`;
  return rows[0] ? Number(rows[0].next_value) : 1;
}

/**
 * Formats a number with a pattern: `{YYYY}` year, `{YY}`, `{seq}` or `{seq:6}` (zero padded).
 * E.g. `FAC-{YYYY}-{seq:6}` → `FAC-2026-000042`.
 */
export function formatSequence(pattern: string, value: number, year?: number): string {
  return pattern
    .replace(/\{YYYY\}/g, String(year ?? ''))
    .replace(/\{YY\}/g, String(year ?? '').slice(-2))
    .replace(/\{seq(?::(\d{1,2}))?\}/g, (_m, pad?: string) =>
      pad ? String(value).padStart(Number(pad), '0') : String(value),
    );
}
