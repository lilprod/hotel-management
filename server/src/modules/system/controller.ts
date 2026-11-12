import type { Request } from 'express';
import { loadGrants } from '../../http/helpers.js';
import { AppError } from '../../lib/errors.js';
import { whoami } from './service.js';

export async function getWhoami(req: Request) {
  if (!req.tenant) throw new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });
  const grants = await loadGrants(req);
  return whoami(req.services, req.tenant, grants);
}
