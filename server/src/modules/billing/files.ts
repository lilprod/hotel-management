import { randomUUID } from 'node:crypto';
import { runWithTenant } from '@hm/database';
import type { Request, RequestHandler } from 'express';
import type { Services } from '../../core/container.js';
import { AppError, notFound } from '../../lib/errors.js';
import { upload } from '../../lib/upload.js';
import { notificationDeps } from '../notifications/deps.js';
import { signedFileUrl } from './documents.js';

/** Payment proofs (SA-31 / TN-31): image or PDF, ≤ 5 MB. */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const proofUpload = (): RequestHandler =>
  upload({
    maxBytes: PROOF_MAX_BYTES,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  });

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Stores an uploaded proof in the tenant's storage and `files` (sensitive, signed URLs). */
export async function storeProof(
  services: Services,
  req: Request,
  tenantId: string,
  createdBy: string | null,
) {
  const f = req.file;
  if (!f)
    throw new AppError('VALIDATION_ERROR', undefined, {
      errors: [{ path: 'file', message: 'A file is required', code: 'required' }],
    });
  const { storage } = notificationDeps(services);
  const fileName = (f.originalname || 'proof').replace(/[^\w.-]+/g, '_').slice(0, 120);
  const stored = await runWithTenant(tenantId, () =>
    storage.put({
      key: `billing/proofs/${randomUUID()}.${EXT[f.mimetype] ?? 'bin'}`,
      body: f.buffer,
      contentType: f.mimetype,
      fileName,
    }),
  );
  const row = await services.admin.file.create({
    data: {
      tenantId,
      key: stored.key,
      originalName: fileName,
      mime: f.mimetype,
      size: BigInt(stored.size),
      isSensitive: true,
      scanStatus: 'PENDING',
      createdBy,
    },
  });
  return { fileId: row.id, size: stored.size, mime: f.mimetype };
}

/** Signed URL (5 min) + mime of a stored proof, or 404 when the record has none. */
export async function proofAttachment(services: Services, tenantId: string, fileId: string | null) {
  if (!fileId) throw notFound('Attachment');
  const file = await services.admin.file.findFirst({
    where: { id: fileId, tenantId },
    select: { mime: true },
  });
  const url = file ? await signedFileUrl(services, tenantId, fileId) : null;
  if (!file || !url) throw notFound('Attachment');
  return { url, mime: file.mime };
}
