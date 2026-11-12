import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { AppError } from './errors.js';

export const TOKEN_SCOPES = ['staff', 'portal', 'platform'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** Access token claims (doc 05 §1): sub, tid, sid, perm_ver + scope. */
export const accessClaimsSchema = z
  .object({
    sub: z.string().uuid(),
    tid: z.string().uuid().optional(),
    sid: z.string().min(1),
    perm_ver: z.number().int().min(0).default(0),
    scope: z.enum(TOKEN_SCOPES),
  })
  .refine((c) => (c.scope === 'platform' ? c.tid === undefined : c.tid !== undefined), {
    message: 'tid is required for staff/portal tokens and forbidden for platform tokens',
    path: ['tid'],
  });
export type AccessClaims = z.infer<typeof accessClaimsSchema>;

export interface JwtSettings {
  secret: string;
  issuer: string;
  audience: string;
}

const keyCache = new Map<string, Uint8Array>();
const keyOf = (secret: string) => {
  let k = keyCache.get(secret);
  if (!k) {
    k = new TextEncoder().encode(secret);
    keyCache.set(secret, k);
  }
  return k;
};

/** Verifies an access token (HS256, issuer, audience, expiry) and validates its claims. */
export async function verifyAccessToken(token: string, s: JwtSettings): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, keyOf(s.secret), {
      issuer: s.issuer,
      audience: s.audience,
      algorithms: ['HS256'],
    });
    const parsed = accessClaimsSchema.safeParse(payload);
    if (!parsed.success) throw new AppError('UNAUTHENTICATED', 'Invalid token claims');
    return parsed.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const detail =
      err instanceof joseErrors.JWTExpired ? 'Access token expired' : 'Invalid access token';
    throw new AppError('UNAUTHENTICATED', undefined, { detail });
  }
}

/**
 * Signs an access token. Login / refresh flows are delivered by the auth module; the core only
 * uses this from tests (see test/helpers) and future token issuance.
 */
export async function signAccessToken(
  claims: Omit<AccessClaims, 'perm_ver'> & { perm_ver?: number },
  s: JwtSettings,
  expiresIn: string | number = '15m',
): Promise<string> {
  const { sub, ...rest } = claims;
  return new SignJWT({ ...rest, perm_ver: claims.perm_ver ?? 0 })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuer(s.issuer)
    .setAudience(s.audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(keyOf(s.secret));
}
