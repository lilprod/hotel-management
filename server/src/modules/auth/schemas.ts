import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/, 'Invalid e-mail');

export const passwordInput = z.string().min(1).max(256);

export const loginBody = z.object({ email: emailSchema, password: passwordInput });

export const tokenResponse = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  /** Double-submit value to send as `X-CSRF-Token` on /refresh (also set as `hm_csrf` cookie). */
  csrfToken: z.string().optional(),
  mustChangePassword: z.boolean().optional(),
});

export const loginResponse = tokenResponse.partial().extend({
  mfaRequired: z.boolean().optional(),
  mfaSetupRequired: z.boolean().optional(),
  /** Short-lived (5 min) single-use token for /mfa/verify or /mfa/setup + /mfa/activate. */
  challengeToken: z.string().optional(),
  methods: z.array(z.enum(['totp', 'backup_code'])).optional(),
});

export const mfaVerifyBody = z.object({
  challengeToken: z.string().min(10),
  code: z.string().trim().min(6).max(20),
});

export const mfaSetupBody = z.object({ challengeToken: z.string().min(10).optional() });
export const mfaSetupResponse = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  expiresInSeconds: z.number().int(),
});

export const mfaActivateBody = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
  challengeToken: z.string().min(10).optional(),
});
export const mfaActivateResponse = tokenResponse.partial().extend({
  backupCodes: z.array(z.string()),
});

export const passwordConfirmBody = z.object({ password: passwordInput });
export const backupCodesResponse = z.object({ backupCodes: z.array(z.string()) });

export const changePasswordBody = z.object({
  currentPassword: passwordInput,
  newPassword: passwordInput,
});

export const forgotBody = z.object({ email: emailSchema });
export const resetBody = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordInput,
});
export const acceptedResponse = z.object({ ok: z.literal(true) });

export const inviteInspectBody = z.object({ token: z.string().min(20).max(200) });
export const inviteAcceptBody = z.object({
  token: z.string().min(20).max(200),
  password: passwordInput,
  name: z.string().trim().min(1).max(120).optional(),
});

export const sessionSchema = z.object({
  id: z.string().uuid(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  expiresAt: z.string(),
  current: z.boolean(),
  impersonation: z.boolean(),
});
export const sessionsResponse = z.object({ items: z.array(sessionSchema) });
export const idParams = z.object({ id: z.string().uuid() });

export const meResponse = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    status: z.string(),
    mfaEnabled: z.boolean(),
    mustChangePassword: z.boolean(),
    lastLoginAt: z.string().nullable(),
  }),
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  properties: z.array(z.object({ id: z.string(), name: z.string() })),
  permissions: z.array(z.string()),
  allProperties: z.boolean(),
  permVer: z.number().int(),
  subscription: z.object({ status: z.string() }),
  entitlements: z.object({
    planCode: z.string().nullable(),
    features: z.array(z.string()),
    quotas: z.record(z.string(), z.number().nullable()),
  }),
  session: z.object({ id: z.string(), idleMinutes: z.number().int(), mfa: z.boolean() }),
  impersonation: z.object({ by: z.string() }).nullable(),
  legal: z.object({
    blocked: z.boolean(),
    canAccept: z.boolean(),
    pending: z.array(z.object({ id: z.string(), type: z.string(), version: z.string() })),
  }),
});
