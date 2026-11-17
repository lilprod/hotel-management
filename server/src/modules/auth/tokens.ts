import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { Services } from '../../core/container.js';
import { AppError } from '../../lib/errors.js';
import { signAccessToken, type AccessClaims, type TokenScope } from '../../lib/jwt.js';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 30 * 24 * 3600;
export const CHALLENGE_TTL_S = 5 * 60;
export const CHALLENGE_MAX_TRIES = 5;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

export type AccessInput = Omit<AccessClaims, 'perm_ver'> & { perm_ver?: number };

export async function issueAccessToken(
  services: Services,
  claims: AccessInput,
  ttlS = ACCESS_TTL_S,
) {
  const { config } = services;
  const clean = Object.fromEntries(
    Object.entries(claims).filter(([, v]) => v !== undefined && v !== false),
  ) as AccessInput;
  const accessToken = await signAccessToken(
    clean,
    { secret: config.JWT_ACCESS_SECRET, issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE },
    ttlS,
  );
  return { accessToken, tokenType: 'Bearer' as const, expiresIn: ttlS };
}

// ---------------------------------------------------------------------------
// Refresh tokens: `<sessionId>.<secret>`; only the SHA-256 is stored
// ---------------------------------------------------------------------------

export function newRefreshToken(sessionId: string) {
  const token = `${sessionId}.${randomToken(32)}`;
  return { token, hash: sha256(token) };
}

export function parseRefreshToken(
  token: string | undefined,
): { sessionId: string; token: string } | null {
  if (!token) return null;
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/i.exec(token);
  return m ? { sessionId: m[1]!.toLowerCase(), token } : null;
}

// ---------------------------------------------------------------------------
// Cookies (httpOnly refresh cookie + double-submit CSRF cookie, doc 05 §1 / §6)
// ---------------------------------------------------------------------------

export interface CookieSpec {
  name: string;
  path: string;
}

export const COOKIES = {
  staff: { name: 'hm_rt', path: '/api/v1/t/auth' },
  portal: { name: 'hm_prt', path: '/api/v1/portal/auth' },
  platform: { name: 'hm_art', path: '/api/v1/admin/auth' },
} as const satisfies Record<TokenScope, CookieSpec>;

export const CSRF_COOKIE = 'hm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Sets the refresh cookie and a fresh CSRF cookie; returns the CSRF value (also in the body). */
export function setSessionCookies(
  res: Response,
  spec: CookieSpec,
  refreshToken: string,
  maxAgeS: number,
) {
  const csrf = randomToken(18);
  res.cookie(spec.name, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: spec.path,
    maxAge: maxAgeS * 1000,
  });
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeS * 1000,
  });
  return csrf;
}

export function clearSessionCookies(res: Response, spec: CookieSpec) {
  res.clearCookie(spec.name, { httpOnly: true, secure: true, sameSite: 'lax', path: spec.path });
  res.clearCookie(CSRF_COOKIE, { secure: true, sameSite: 'lax', path: '/' });
}

/** Double-submit check for cookie-authenticated endpoints (refresh). */
export function assertCsrf(req: Request): void {
  const cookie = readCookie(req, CSRF_COOKIE);
  const header = req.header(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header))
    throw new AppError('FORBIDDEN', 'CSRF token missing or invalid', {
      meta: { reason: 'CSRF_INVALID' },
    });
}

// ---------------------------------------------------------------------------
// MFA challenge tokens (short-lived, single use, distinct audience)
// ---------------------------------------------------------------------------

export const CHALLENGE_PURPOSES = ['mfa', 'mfa_setup'] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

const challengeClaims = z.object({
  sub: z.string().uuid(),
  jti: z.string().min(8),
  scope: z.enum(['staff', 'portal', 'platform']),
  tid: z.string().uuid().optional(),
  purpose: z.enum(CHALLENGE_PURPOSES),
});
export type ChallengeClaims = z.infer<typeof challengeClaims>;

const enc = new TextEncoder();
const challengeAudience = (services: Services) => `${services.config.JWT_AUDIENCE}:mfa-challenge`;

export async function issueChallenge(
  services: Services,
  c: { sub: string; scope: TokenScope; tid?: string | undefined; purpose: ChallengePurpose },
): Promise<string> {
  const { config } = services;
  return new SignJWT({ scope: c.scope, purpose: c.purpose, ...(c.tid ? { tid: c.tid } : {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(c.sub)
    .setJti(randomUUID())
    .setIssuer(config.JWT_ISSUER)
    .setAudience(challengeAudience(services))
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_S}s`)
    .sign(enc.encode(config.JWT_ACCESS_SECRET));
}

const invalidChallenge = () =>
  new AppError('UNAUTHENTICATED', 'Invalid or expired MFA challenge', {
    meta: { reason: 'MFA_CHALLENGE_INVALID' },
  });

/** Verifies a challenge token for `scope` (and tenant) and counts the attempt. */
export async function verifyChallenge(
  services: Services,
  token: string,
  expect: { scope: TokenScope; tid?: string | undefined; purposes: readonly ChallengePurpose[] },
): Promise<ChallengeClaims> {
  let claims: ChallengeClaims;
  try {
    const { payload } = await jwtVerify(token, enc.encode(services.config.JWT_ACCESS_SECRET), {
      issuer: services.config.JWT_ISSUER,
      audience: challengeAudience(services),
      algorithms: ['HS256'],
    });
    claims = challengeClaims.parse(payload);
  } catch {
    throw invalidChallenge();
  }
  if (claims.scope !== expect.scope || claims.tid !== expect.tid) throw invalidChallenge();
  if (!expect.purposes.includes(claims.purpose)) throw invalidChallenge();
  const { redis } = services;
  if (await redis.exists(`hm:mfa-used:${claims.jti}`)) throw invalidChallenge();
  const tries = await redis.incr(`hm:mfa-tries:${claims.jti}`);
  if (tries === 1) await redis.expire(`hm:mfa-tries:${claims.jti}`, CHALLENGE_TTL_S + 60);
  if (tries > CHALLENGE_MAX_TRIES) throw invalidChallenge();
  return claims;
}

/** Marks a challenge as consumed (single use). */
export async function consumeChallenge(services: Services, claims: ChallengeClaims): Promise<void> {
  const ok = await services.redis.set(
    `hm:mfa-used:${claims.jti}`,
    '1',
    'EX',
    CHALLENGE_TTL_S + 60,
    'NX',
  );
  if (ok !== 'OK') throw invalidChallenge();
}

// ---------------------------------------------------------------------------
// Rate limiting of /auth/* (Redis fixed windows, per IP and per account)
// ---------------------------------------------------------------------------

export interface LimitRule {
  key: string;
  limit: number;
  windowS: number;
}

export async function rateLimit(services: Services, rules: readonly LimitRule[]): Promise<void> {
  for (const r of rules) {
    const k = `hm:auth-rl:${r.key}`;
    const n = await services.redis.incr(k);
    if (n === 1) await services.redis.expire(k, r.windowS);
    if (n > r.limit) {
      const ttl = await services.redis.ttl(k);
      throw new AppError('RATE_LIMITED', undefined, {
        detail: 'Too many attempts, try again later',
        meta: { retryAfterSeconds: Math.max(ttl, 1) },
      });
    }
  }
}

export const ipKey = (req: Request) => (req.ip ?? 'unknown').replace(/^::ffff:/, '');
export const accountKey = (email: string) => sha256(email.trim().toLowerCase()).slice(0, 32);
