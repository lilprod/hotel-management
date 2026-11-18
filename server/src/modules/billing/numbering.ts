import { randomUUID } from 'node:crypto';
import type { TransactionClient } from '@hm/database';

/** Platform documents numbered per year (doc 02 §3, §4.2). */
export const PLATFORM_NUMBERING = {
  invoice: { key: 'platform_invoice', prefix: 'PLT' },
  receipt: { key: 'platform_receipt', prefix: 'REC' },
} as const;

export type PlatformDocument = keyof typeof PLATFORM_NUMBERING;

const PLATFORM_SCOPE = 'platform';

/**
 * Gap-free platform counter (`sequences`, scope `platform`, no tenant): `PLT-2026-000001`.
 * MUST run in the admin transaction that issues the document: the row is locked
 * (`SELECT … FOR UPDATE`) until commit, so concurrent issuers are serialised and a rollback
 * gives the number back.
 */
export async function nextPlatformNumber(
  tx: TransactionClient,
  doc: PlatformDocument,
  year: number,
): Promise<string> {
  const { key, prefix } = PLATFORM_NUMBERING[doc];
  await tx.$executeRaw`
    INSERT INTO sequences (id, tenant_id, scope, key, year, next_value, updated_at)
    VALUES (${randomUUID()}::uuid, NULL, ${PLATFORM_SCOPE}, ${key}, ${year}, 1, now())
    ON CONFLICT (scope, key, year) DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; next_value: bigint }[]>`
    SELECT id, next_value FROM sequences
    WHERE scope = ${PLATFORM_SCOPE} AND key = ${key} AND year = ${year}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error('Platform sequence row not found');
  await tx.$executeRaw`
    UPDATE sequences SET next_value = next_value + 1, updated_at = now() WHERE id = ${row.id}::uuid`;
  return `${prefix}-${year}-${String(row.next_value).padStart(6, '0')}`;
}
