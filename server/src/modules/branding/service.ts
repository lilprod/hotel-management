import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { Services } from '../../core/container.js';
import { recordAudit } from '../../middleware/audit.js';
import { AppError } from '../../lib/errors.js';
import { checkContrast, contrastRatio } from './contrast.js';
import { brandingDeps } from './deps.js';
import { declaredMimeMatches, EXTENSION, readImageInfo } from './image-info.js';
import { BrandingRepository, type BrandingRow } from './repository.js';
import {
  ASSET_KINDS,
  brandingSettings,
  DEFAULT_LEGAL_MENTIONS_TG,
  TOGO_TAX_REGIMES,
  type AssetKind,
  type BrandingUpdate,
  type BrandingView,
  type PublicAssetKind,
  type PublicBranding,
} from './schemas.js';

export const DEFAULT_PRIMARY = '#7a5a14';
export const DEFAULT_SECONDARY = '#1f2a37';

interface AssetSpec {
  column: keyof Pick<
    BrandingRow,
    'logoFileId' | 'logoDarkFileId' | 'faviconFileId' | 'loginBgFileId' | 'signatureFileId'
  >;
  mimes: readonly string[];
  maxBytes: number;
  min: { width: number; height: number };
  max: { width: number; height: number };
  /** Favicons must be (nearly) square. */
  square?: boolean;
}

const RASTER = ['image/png', 'image/jpeg', 'image/webp'];

/** Upload rules per asset: MIME, size and image dimension limits. */
export const ASSET_SPECS: Record<AssetKind, AssetSpec> = {
  logo: {
    column: 'logoFileId',
    mimes: RASTER,
    maxBytes: 1024 * 1024,
    min: { width: 32, height: 32 },
    max: { width: 2000, height: 2000 },
  },
  'logo-dark': {
    column: 'logoDarkFileId',
    mimes: RASTER,
    maxBytes: 1024 * 1024,
    min: { width: 32, height: 32 },
    max: { width: 2000, height: 2000 },
  },
  favicon: {
    column: 'faviconFileId',
    mimes: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'],
    maxBytes: 256 * 1024,
    min: { width: 16, height: 16 },
    max: { width: 512, height: 512 },
    square: true,
  },
  'login-background': {
    column: 'loginBgFileId',
    mimes: RASTER,
    maxBytes: 3 * 1024 * 1024,
    min: { width: 640, height: 360 },
    max: { width: 4096, height: 4096 },
  },
  signature: {
    column: 'signatureFileId',
    mimes: RASTER,
    maxBytes: 512 * 1024,
    min: { width: 64, height: 32 },
    max: { width: 1600, height: 1600 },
  },
};

/** Largest file any asset may be: the multer limit. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(ASSET_SPECS).map((s) => s.maxBytes));
export const UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
];

const PUBLIC_ASSET_PATH = '/api/v1/portal/branding/assets';

function invalid(path: string, message: string, code: string, status?: number): AppError {
  return new AppError('VALIDATION_ERROR', undefined, {
    errors: [{ path, message, code }],
    ...(status ? { status } : {}),
  });
}

/** Normalizes `#RRGGBB` to lower case. */
const norm = (c: string | null | undefined) => (c ? c.toLowerCase() : (c ?? null));

export class BrandingService {
  private readonly repo: BrandingRepository;

  constructor(private readonly services: Services) {
    this.repo = new BrandingRepository(services.db);
  }

  private assetUrl(kind: AssetKind, row: BrandingRow, fileId: string): string {
    // Stable URL (redirects to a fresh 5-minute signed URL); `v` busts caches on replacement.
    void row;
    return `${PUBLIC_ASSET_PATH}/${kind}?v=${fileId.slice(0, 8)}`;
  }

  async view(tenantId: string): Promise<BrandingView> {
    const [row, legal, profile] = await Promise.all([
      this.repo.find(),
      this.services.settings.get(brandingSettings.legal, { tenantId }),
      this.services.settings.get(brandingSettings.profile, { tenantId }),
    ]);
    const files = row ? await this.repo.filesOf(row) : new Map();
    const assets = {} as BrandingView['assets'];
    for (const kind of ASSET_KINDS) {
      const id = row?.[ASSET_SPECS[kind].column] ?? null;
      const file = id ? files.get(id) : undefined;
      assets[kind] =
        row && id && file
          ? {
              url:
                kind === 'signature'
                  ? `/api/v1/t/branding/assets/${kind}`
                  : this.assetUrl(kind, row, id),
              size: Number(file.size),
              mime: file.mime,
            }
          : null;
    }
    return {
      primaryColor: row?.primaryColor ?? null,
      secondaryColor: row?.secondaryColor ?? null,
      docHeader: row?.docHeader ?? null,
      docFooter: row?.docFooter ?? null,
      legalMentions: row?.legalMentions ?? null,
      emailSenderName: row?.emailSenderName ?? null,
      loginMessage: row?.loginMessage ?? null,
      legal,
      profile,
      assets,
      contrast: checkContrast(
        row?.primaryColor ?? DEFAULT_PRIMARY,
        row?.secondaryColor ?? DEFAULT_SECONDARY,
      ),
      defaults: {
        primaryColor: DEFAULT_PRIMARY,
        secondaryColor: DEFAULT_SECONDARY,
        legalMentions: DEFAULT_LEGAL_MENTIONS_TG,
        taxRegimes: [...TOGO_TAX_REGIMES],
      },
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async update(req: Request, tenantId: string, input: BrandingUpdate): Promise<BrandingView> {
    const before = await this.view(tenantId);
    const { legal, profile, ...columns } = input;
    const data: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(columns)) {
      if (v === undefined) continue;
      data[k] = k === 'primaryColor' || k === 'secondaryColor' ? norm(v as string | null) : v;
    }
    if (Object.keys(data).length) await this.repo.upsert(tenantId, data);
    else if (!(await this.repo.find())) await this.repo.upsert(tenantId, {});

    if (legal) {
      await this.services.settings.set(
        brandingSettings.legal,
        { ...before.legal, ...legal },
        { tenantId, scope: 'TENANT' },
      );
    }
    if (profile) {
      await this.services.settings.set(
        brandingSettings.profile,
        {
          languages: profile.languages ?? before.profile.languages,
          contact: { ...before.profile.contact, ...profile.contact },
        },
        { tenantId, scope: 'TENANT' },
      );
    }
    const after = await this.view(tenantId);
    recordAudit(req, {
      action: 'branding.update',
      entity: 'branding',
      before: auditShape(before),
      after: auditShape(after),
    });
    return after;
  }

  /** Validates an uploaded image (real format, size, dimensions) and stores it. */
  async uploadAsset(
    req: Request,
    tenantId: string,
    userId: string,
    kind: AssetKind,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw invalid('file', 'A file is required', 'required');
    const spec = ASSET_SPECS[kind];
    if (!spec.mimes.includes(file.mimetype))
      throw invalid('file', `Unsupported file type ${file.mimetype} for ${kind}`, 'invalid_type');
    if (file.size > spec.maxBytes)
      throw invalid(
        'file',
        `File too large (${file.size} bytes, max ${spec.maxBytes} for ${kind})`,
        'too_big',
        413,
      );
    const info = readImageInfo(file.buffer);
    if (!info || !declaredMimeMatches(file.mimetype, info.mime))
      throw invalid('file', 'File content does not match its declared type', 'invalid_type');
    const { width, height } = info;
    if (
      width < spec.min.width ||
      height < spec.min.height ||
      width > spec.max.width ||
      height > spec.max.height
    )
      throw invalid(
        'file',
        `Image is ${width}x${height}px; allowed ${spec.min.width}x${spec.min.height} to ${spec.max.width}x${spec.max.height}`,
        'image_dimensions',
      );
    if (spec.square && Math.abs(width - height) > Math.max(width, height) * 0.1)
      throw invalid('file', 'Favicon must be square', 'image_dimensions');

    const { storage } = brandingDeps(this.services);
    const objectKey = `branding/${kind}-${randomUUID()}.${EXTENSION[info.mime]}`;
    const stored = await storage.put({ key: objectKey, body: file.buffer, contentType: info.mime });
    const fileRow = await this.repo.createFile({
      tenantId,
      key: stored.key,
      originalName: file.originalname.slice(0, 200),
      mime: info.mime,
      size: BigInt(stored.size),
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
      createdBy: userId,
    });
    const previous = await this.repo.setAsset(tenantId, spec.column, fileRow.id);
    if (previous) await this.dropFile(previous);
    recordAudit(req, {
      action: 'branding.asset.upload',
      entity: 'branding',
      after: { kind, fileId: fileRow.id, mime: info.mime, size: stored.size },
    });
    const row = await this.repo.find();
    const url =
      kind === 'signature'
        ? `/api/v1/t/branding/assets/${kind}`
        : this.assetUrl(kind, row as BrandingRow, fileRow.id);
    return { kind, asset: { url, size: stored.size, mime: info.mime }, width, height };
  }

  async removeAsset(req: Request, tenantId: string, kind: AssetKind): Promise<void> {
    const previous = await this.repo.setAsset(tenantId, ASSET_SPECS[kind].column, null);
    if (previous) await this.dropFile(previous);
    recordAudit(req, { action: 'branding.asset.remove', entity: 'branding', after: { kind } });
  }

  private async dropFile(fileId: string): Promise<void> {
    const file = await this.repo.deleteFile(fileId);
    if (!file) return;
    try {
      await brandingDeps(this.services).storage.delete(file.key);
    } catch (err) {
      this.services.logger.warn('branding: orphan object left in storage', { key: file.key, err });
    }
  }

  /** Short-lived signed URL of an asset of the current tenant (null when not set). */
  async signedAssetUrl(kind: AssetKind): Promise<string | null> {
    const row = await this.repo.find();
    const id = row?.[ASSET_SPECS[kind].column];
    if (!row || !id) return null;
    const file = await this.repo.fileById(id);
    if (!file) return null;
    return brandingDeps(this.services).storage.signedUrl(file.key);
  }

  /** Public, unauthenticated view for the portal (tenant from the Host header). */
  async publicView(tenant: {
    id: string;
    name: string;
    defaultLocale?: string;
  }): Promise<PublicBranding> {
    const [row, profile, tenantRow] = await Promise.all([
      this.repo.find(),
      this.services.settings.get(brandingSettings.profile, { tenantId: tenant.id }),
      this.services.admin.tenant.findUnique({
        where: { id: tenant.id },
        select: { name: true, phone: true, email: true, defaultLocale: true },
      }),
    ]);
    const primary = row?.primaryColor ?? DEFAULT_PRIMARY;
    const url = (kind: PublicAssetKind): string | null => {
      const id = row?.[ASSET_SPECS[kind].column];
      return row && id ? this.assetUrl(kind, row, id) : null;
    };
    return {
      name: tenantRow?.name ?? tenant.name,
      colors: {
        primary,
        secondary: row?.secondaryColor ?? DEFAULT_SECONDARY,
        onPrimary:
          contrastRatio(primary, '#ffffff') >= contrastRatio(primary, '#000000')
            ? '#ffffff'
            : '#000000',
      },
      logoUrl: url('logo'),
      logoDarkUrl: url('logo-dark'),
      faviconUrl: url('favicon'),
      loginBackgroundUrl: url('login-background'),
      loginMessage: row?.loginMessage ?? null,
      languages: profile.languages,
      defaultLocale: tenantRow?.defaultLocale ?? 'fr',
      contact: {
        ...profile.contact,
        phone: profile.contact.phone ?? tenantRow?.phone ?? null,
        email: profile.contact.email ?? tenantRow?.email ?? null,
      },
    };
  }
}

function auditShape(v: BrandingView) {
  return {
    primaryColor: v.primaryColor,
    secondaryColor: v.secondaryColor,
    emailSenderName: v.emailSenderName,
    legal: v.legal,
  };
}
