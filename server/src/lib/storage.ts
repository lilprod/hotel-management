import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireTenantId } from '@hm/database';
import type { Config } from '../config.js';
import { AppError } from './errors.js';

/** Signed URLs live 5 minutes (doc 05 §3). */
export const SIGNED_URL_TTL_S = 300;

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** `t/{tenantId}/{key}` — the tenant always comes from the context, never from the client. */
export function tenantObjectKey(tenantId: string, key: string): string {
  const segments = key.split('/').filter(Boolean);
  if (!segments.length || segments.some((s) => s === '.' || s === '..' || !SAFE_SEGMENT.test(s)))
    throw new AppError('BAD_REQUEST', 'Invalid object key');
  return `t/${tenantId}/${segments.join('/')}`;
}

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  /** Suggested download file name. */
  fileName?: string;
}

/**
 * S3/MinIO storage scoped to the current tenant. Every key is prefixed `t/{tenantId}/`;
 * reads are only possible through 5-minute signed URLs issued after the caller's checks.
 */
export class TenantStorage {
  constructor(
    readonly client: S3Client,
    readonly bucket: string,
  ) {}

  static fromConfig(config: Config): TenantStorage {
    const client = new S3Client({
      region: config.S3_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      ...(config.S3_ACCESS_KEY && config.S3_SECRET_KEY
        ? {
            credentials: {
              accessKeyId: config.S3_ACCESS_KEY,
              secretAccessKey: config.S3_SECRET_KEY,
            },
          }
        : {}),
    });
    return new TenantStorage(client, config.S3_BUCKET);
  }

  /** Full object key for the current tenant. */
  keyFor(key: string): string {
    return tenantObjectKey(requireTenantId(), key);
  }

  async put(input: PutObjectInput): Promise<{ key: string; size: number }> {
    const Key = this.keyFor(input.key);
    const size =
      typeof input.body === 'string' ? Buffer.byteLength(input.body) : input.body.byteLength;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.fileName
          ? {
              ContentDisposition: `attachment; filename="${input.fileName.replace(/["\\\r\n]/g, '_')}"`,
            }
          : {}),
      }),
    );
    return { key: Key, size };
  }

  /** Signed GET URL (5 min) for a key of the current tenant (relative or already prefixed). */
  async signedUrl(key: string, expiresIn = SIGNED_URL_TTL_S): Promise<string> {
    const Key = this.ownKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key }), {
      expiresIn: Math.min(expiresIn, SIGNED_URL_TTL_S),
    });
  }

  /** Signed PUT URL (5 min) for direct browser uploads. */
  async signedUploadUrl(key: string, contentType: string): Promise<string> {
    const Key = this.keyFor(key);
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key, ContentType: contentType }),
      { expiresIn: SIGNED_URL_TTL_S },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.ownKey(key) }));
  }

  /** Accepts `t/{current}/x` or `x`; refuses another tenant's prefix. */
  private ownKey(key: string): string {
    const tenantId = requireTenantId();
    if (key.startsWith('t/')) {
      const prefix = `t/${tenantId}/`;
      if (!key.startsWith(prefix)) throw new AppError('FORBIDDEN', 'Object of another tenant');
      return tenantObjectKey(tenantId, key.slice(prefix.length));
    }
    return tenantObjectKey(tenantId, key);
  }
}
