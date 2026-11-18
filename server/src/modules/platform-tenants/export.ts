import { runWithTenant } from '@hm/database';
import type { Services } from '../../core/container.js';
import { billingNow, isoOf } from '../billing/common.js';
import { toCsv } from '../billing/csv.js';
import { signedFileUrl } from '../billing/documents.js';
import { notificationDeps } from '../notifications/deps.js';
import { buildZip, type ZipEntry } from './zip.js';

/** Columns never exported (secrets, hashes, tokens). */
const SECRET_COLUMN = /(password|secret|token|hash|totp|backup_codes)/i;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const MAX_ROWS_PER_TABLE = 200_000;

function plain(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && (v as { constructor?: unknown }).constructor === Object) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  if (v && typeof v === 'object' && 'toString' in v) return String(v);
  return v;
}

/**
 * SA-26 / EX-11: full export of a tenant — one JSON and one CSV file per table holding a
 * `tenant_id` (plus the tenant row), zipped and stored in the tenant's storage (`files`,
 * sensitive, signed URL). Secret columns are left out.
 */
export async function exportTenant(services: Services, tenantId: string, createdBy: string | null) {
  const { admin } = services;
  const tables = await admin.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name`;
  const entries: ZipEntry[] = [];
  const manifest: { table: string; rows: number }[] = [];
  const add = (table: string, rows: Record<string, unknown>[]) => {
    const clean = rows.map((r) =>
      Object.fromEntries(
        Object.entries(r)
          .filter(([k]) => !SECRET_COLUMN.test(k))
          .map(([k, v]) => [k, plain(v)]),
      ),
    );
    const columns = clean[0] ? Object.keys(clean[0]) : [];
    entries.push({ name: `json/${table}.json`, data: JSON.stringify(clean, null, 2) });
    entries.push({ name: `csv/${table}.csv`, data: toCsv(columns, clean) });
    manifest.push({ table, rows: clean.length });
  };
  const tenantRows = await admin.$queryRawUnsafe<Record<string, unknown>[]>(
    'SELECT * FROM "tenants" WHERE id = $1::uuid',
    tenantId,
  );
  add('tenants', tenantRows);
  for (const { table_name: table } of tables) {
    if (!IDENT.test(table)) continue;
    const rows = await admin.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${table}" WHERE tenant_id = $1::uuid LIMIT ${MAX_ROWS_PER_TABLE}`,
      tenantId,
    );
    if (rows.length) add(table, rows);
  }
  const now = billingNow();
  entries.unshift({
    name: 'manifest.json',
    data: JSON.stringify({ tenantId, exportedAt: now.toISOString(), tables: manifest }, null, 2),
  });
  const zip = buildZip(entries, now);
  const fileName = `export-${tenantId.slice(0, 8)}-${isoOf(now)}.zip`;
  const { storage } = notificationDeps(services);
  const stored = await runWithTenant(tenantId, () =>
    storage.put({
      key: `exports/${now.getTime()}-${fileName}`,
      body: zip,
      contentType: 'application/zip',
      fileName,
    }),
  );
  const file = await admin.file.create({
    data: {
      tenantId,
      key: stored.key,
      originalName: fileName,
      mime: 'application/zip',
      size: BigInt(stored.size),
      isSensitive: true,
      scanStatus: 'CLEAN',
      createdBy,
    },
  });
  return {
    fileId: file.id,
    fileName,
    size: stored.size,
    tables: manifest.length,
    url: await signedFileUrl(services, tenantId, file.id),
  };
}
