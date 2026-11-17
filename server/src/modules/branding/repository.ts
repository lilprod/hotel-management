import { requireTenantId, type AppClient, type Prisma } from '@hm/database';

export type BrandingRow = NonNullable<Awaited<ReturnType<AppClient['branding']['findFirst']>>>;

type AssetColumn =
  | 'logoFileId'
  | 'logoDarkFileId'
  | 'faviconFileId'
  | 'loginBgFileId'
  | 'signatureFileId';

const ASSET_COLUMNS: AssetColumn[] = [
  'logoFileId',
  'logoDarkFileId',
  'faviconFileId',
  'loginBgFileId',
  'signatureFileId',
];

/** RLS-scoped data access (tenant from the request context: every query is filtered by RLS). */
export class BrandingRepository {
  constructor(private readonly db: AppClient) {}

  find(): Promise<BrandingRow | null> {
    return this.db.branding.findFirst({ where: { tenantId: requireTenantId() } });
  }

  upsert(tenantId: string, data: Prisma.BrandingUncheckedUpdateInput) {
    return this.db.branding.upsert({
      where: { tenantId },
      create: { tenantId, ...(data as Prisma.BrandingUncheckedCreateInput) },
      update: data,
    });
  }

  /** Sets (or clears) an asset column and returns the file id it replaced. */
  async setAsset(
    tenantId: string,
    column: AssetColumn,
    fileId: string | null,
  ): Promise<string | null> {
    const current = await this.find();
    const previous = current?.[column] ?? null;
    await this.upsert(tenantId, { [column]: fileId });
    return previous;
  }

  async filesOf(row: BrandingRow) {
    const ids = ASSET_COLUMNS.map((c) => row[c]).filter((v): v is string => !!v);
    const files = ids.length
      ? await this.db.file.findMany({
          where: { id: { in: ids }, tenantId: requireTenantId() },
          select: { id: true, mime: true, size: true, key: true },
        })
      : [];
    return new Map(files.map((f) => [f.id, f]));
  }

  fileById(id: string) {
    return this.db.file.findFirst({ where: { id, tenantId: requireTenantId() } });
  }

  createFile(data: Prisma.FileUncheckedCreateInput) {
    return this.db.file.create({ data });
  }

  async deleteFile(id: string) {
    const file = await this.fileById(id);
    if (!file) return null;
    await this.db.file.delete({ where: { id } });
    return file;
  }
}
