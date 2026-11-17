import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { requireAuth } from '../../http/helpers.js';
import { PLATFORM_ROLES, platformRole } from '../../middleware/platform-guard.js';
import {
  changePasswordBody,
  emailSchema,
  loginBody,
  loginResponse,
  mfaActivateBody,
  mfaActivateResponse,
  mfaSetupBody,
  mfaSetupResponse,
  mfaVerifyBody,
  passwordInput,
  tokenResponse,
} from '../auth/schemas.js';
import { endImpersonation, listImpersonationEvents, startImpersonation } from './impersonation.js';
import * as svc from './service.js';
import * as users from './users-service.js';

const tags = ['platform: auth'];
const platform = [requireAuth('platform')];

/** Platform (Super Admin) authentication `/api/v1/admin/auth` — TOTP mandatory (SA-40). */
export const platformAuthRouter = createModuleRouter()
  .route({
    method: 'post',
    path: '/login',
    tags,
    public: true,
    summary: 'Password step: always returns an MFA challenge (mfa or mfa_setup)',
    request: { body: loginBody },
    responses: { 200: { description: 'MFA challenge', schema: loginResponse } },
    handler: (req) => svc.platformLogin(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/mfa/verify',
    tags,
    public: true,
    summary: 'TOTP / backup code step: opens the session',
    request: { body: mfaVerifyBody },
    responses: { 200: { description: 'Session', schema: tokenResponse } },
    handler: (req, res) => svc.platformMfaVerify(req, res, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/mfa/setup',
    tags,
    public: true,
    summary: 'First login: TOTP enrolment (mfa_setup challenge)',
    request: { body: mfaSetupBody },
    responses: { 200: { description: 'Secret', schema: mfaSetupResponse } },
    handler: (req) => svc.platformMfaSetup(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/mfa/activate',
    tags,
    public: true,
    summary: 'Confirm the enrolment: backup codes + session',
    request: { body: mfaActivateBody },
    responses: { 200: { description: 'Session', schema: mfaActivateResponse } },
    handler: (req, res) => svc.platformMfaActivate(req, res, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/refresh',
    tags,
    public: true,
    summary: 'Rotate the platform refresh cookie (X-CSRF-Token)',
    responses: { 200: { description: 'Access token', schema: tokenResponse } },
    handler: (req, res) => svc.platformRefresh(req, res),
  })
  .route({
    method: 'post',
    path: '/logout',
    tags,
    public: true,
    summary: 'Revoke the platform session',
    status: 204,
    handler: async (req, res) => {
      await svc.platformLogout(req, res);
      res.status(204).end();
    },
  })
  .route({
    method: 'get',
    path: '/me',
    tags,
    summary: 'Current platform user',
    middleware: platform,
    handler: (req) => svc.platformMe(req),
  })
  .route({
    method: 'post',
    path: '/password',
    tags,
    summary: 'Change my platform password',
    middleware: platform,
    request: { body: changePasswordBody },
    status: 204,
    handler: async (req, res) => {
      await svc.platformChangePassword(req, req.valid.body);
      res.status(204).end();
    },
  });

const roleEnum = z.enum(PLATFORM_ROLES);
const platformUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleEnum,
  isActive: z.boolean(),
  mfaEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
const idParams = z.object({ id: z.string().uuid() });
const usersTags = ['platform: users'];

/** Platform users CRUD (SUPER_ADMIN only) `/api/v1/admin/platform-users`. */
export const platformUsersRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: usersTags,
    summary: 'List platform users',
    middleware: [platformRole('SUPER_ADMIN')],
    responses: {
      200: { description: 'Users', schema: z.object({ items: z.array(platformUser) }) },
    },
    handler: (req) => users.listPlatformUsers(req),
  })
  .route({
    method: 'post',
    path: '/',
    tags: usersTags,
    summary: 'Create a platform user (TOTP enrolment at first login)',
    middleware: [platformRole('SUPER_ADMIN')],
    request: {
      body: z.object({
        email: emailSchema,
        name: z.string().trim().min(1).max(120),
        role: roleEnum,
        password: passwordInput,
      }),
    },
    status: 201,
    responses: { 201: { description: 'User', schema: platformUser } },
    handler: (req) => users.createPlatformUser(req, req.valid.body),
  })
  .route({
    method: 'patch',
    path: '/:id',
    tags: usersTags,
    summary: 'Update name / role / active flag',
    middleware: [platformRole('SUPER_ADMIN')],
    request: {
      params: idParams,
      body: z
        .object({
          name: z.string().trim().min(1).max(120).optional(),
          role: roleEnum.optional(),
          isActive: z.boolean().optional(),
        })
        .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
    },
    responses: { 200: { description: 'User', schema: platformUser } },
    handler: (req) => users.updatePlatformUser(req, req.valid.params.id, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/:id/mfa/reset',
    tags: usersTags,
    summary: 'Reset the TOTP of a platform user (lost device)',
    middleware: [platformRole('SUPER_ADMIN')],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      await users.resetPlatformUserMfa(req, req.valid.params.id);
      res.status(204).end();
    },
  });

const impTags = ['platform: impersonation'];

/** Support impersonation `/api/v1/admin/impersonations` (SUPPORT / SUPER_ADMIN). */
export const impersonationRouter = createModuleRouter()
  .route({
    method: 'post',
    path: '/',
    tags: impTags,
    summary: 'Start a ≤ 30 min "act as" session on a consenting tenant (reason required)',
    middleware: [platformRole('SUPPORT')],
    request: {
      body: z.object({
        tenantId: z.string().uuid(),
        reason: z.string().trim().min(10).max(500),
        durationMinutes: z.number().int().min(1).max(30).default(30),
        userId: z.string().uuid().optional(),
      }),
    },
    status: 201,
    handler: (req) => startImpersonation(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/:id/end',
    tags: impTags,
    summary: 'End an impersonation session',
    middleware: [platformRole('SUPPORT')],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      await endImpersonation(req, req.valid.params.id);
      res.status(204).end();
    },
  })
  .route({
    method: 'get',
    path: '/',
    tags: impTags,
    summary: 'Impersonation events (platform audit)',
    middleware: [platformRole('SUPPORT', 'READ_ONLY')],
    request: { query: z.object({ tenantId: z.string().uuid().optional() }) },
    handler: (req) => listImpersonationEvents(req, req.valid.query.tenantId),
  });
