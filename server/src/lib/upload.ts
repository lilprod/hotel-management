import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from './errors.js';

export interface UploadOptions {
  /** Multipart field name (default `file`). */
  field?: string;
  /** Max size per file in bytes (default 10 MB). */
  maxBytes?: number;
  /** Allowed MIME types (exact, or `image/*`). */
  mimeTypes: readonly string[];
  /** Max number of files (default 1 → `req.file`; > 1 → `req.files`). */
  maxFiles?: number;
}

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function mimeAllowed(mime: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => (a.endsWith('/*') ? mime.startsWith(a.slice(0, -1)) : a === mime));
}

/**
 * Multer memoryStorage upload with size / count / MIME limits. Files stay in memory and are
 * pushed to TenantStorage by the service (antivirus scan is a later lot).
 */
export function upload(opts: UploadOptions): RequestHandler {
  const field = opts.field ?? 'file';
  const maxFiles = opts.maxFiles ?? 1;
  const m = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES, files: maxFiles, fields: 20 },
    fileFilter: (_req, file, cb) => {
      if (mimeAllowed(file.mimetype, opts.mimeTypes)) return cb(null, true);
      cb(
        new AppError('VALIDATION_ERROR', undefined, {
          errors: [
            {
              path: field,
              message: `Unsupported file type ${file.mimetype}`,
              code: 'invalid_type',
            },
          ],
        }),
      );
    },
  });
  return maxFiles > 1 ? m.array(field, maxFiles) : m.single(field);
}
