import { createHash, randomUUID } from 'node:crypto';
import { invalid } from '../property/common.js';
import { notificationDeps } from '../notifications/deps.js';
import type { RCtx } from '../reservations/context.js';

export const FILE_MAX_BYTES = 2 * 1024 * 1024;
export const FILE_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const;
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
};

/**
 * Stores a signature image or an ID scan (private bucket, sensitive file). The content is checked
 * against its declared type; reads go through signed URLs only.
 */
export async function uploadFile(
  ctx: RCtx,
  kind: 'signature' | 'id_scan',
  file: Express.Multer.File | undefined,
) {
  if (!file) throw invalid('file', 'A file is required', 'required');
  const check = MAGIC[file.mimetype];
  if (!check || !check(file.buffer))
    throw invalid('file', 'File content does not match its declared type', 'invalid_type');
  if (kind === 'signature' && file.mimetype === 'application/pdf')
    throw invalid('file', 'A signature must be an image', 'invalid_type');
  const { storage } = notificationDeps(ctx.services);
  const stored = await storage.put({
    key: `front-desk/${kind}/${randomUUID()}.${EXT[file.mimetype]}`,
    body: file.buffer,
    contentType: file.mimetype,
  });
  const row = await ctx.db.file.create({
    data: {
      tenantId: ctx.tenantId,
      key: stored.key,
      originalName: file.originalname.slice(0, 200),
      mime: file.mimetype,
      size: BigInt(stored.size),
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
      isSensitive: true,
      scanStatus: 'PENDING',
      createdBy: ctx.actorId,
    },
  });
  await ctx.audit({
    action: `front_desk.file.${kind}`,
    entity: 'file',
    entityId: row.id,
    after: { mime: row.mime, size: stored.size },
  });
  return { fileId: row.id, size: stored.size };
}
