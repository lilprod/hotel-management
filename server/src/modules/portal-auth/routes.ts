import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { requireAuth } from '../../http/helpers.js';
import {
  acceptedResponse,
  changePasswordBody,
  emailSchema,
  forgotBody,
  loginBody,
  passwordInput,
  resetBody,
  tokenResponse,
} from '../auth/schemas.js';
import * as portal from './service.js';

const tags = ['portal: auth'];
const guest = [requireAuth('portal')];

const meResponse = z.object({
  account: z.object({
    id: z.string(),
    email: z.string(),
    locale: z.string(),
    emailVerified: z.boolean(),
    lastLoginAt: z.string().nullable(),
  }),
  guest: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
});

/** Guest (portal) authentication `/api/v1/portal/auth` on `guest_accounts` (scope `portal`). */
export const portalAuthRouter = createModuleRouter()
  .route({
    method: 'post',
    path: '/register',
    tags,
    public: true,
    summary: 'Create a guest account (verification e-mail); always 202',
    request: {
      body: z.object({
        email: emailSchema,
        password: passwordInput,
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        phone: z.string().trim().max(30).optional(),
        locale: z.enum(['fr', 'en']).default('fr'),
      }),
    },
    status: 202,
    responses: { 202: { description: 'Accepted', schema: acceptedResponse } },
    handler: (req) => portal.register(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/verify-email',
    tags,
    public: true,
    summary: 'Confirm the e-mail address (link sent at registration)',
    request: { body: z.object({ token: z.string().min(20).max(200) }) },
    responses: { 200: { description: 'Verified', schema: acceptedResponse } },
    handler: (req) => portal.verifyEmail(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/verify-email/resend',
    tags,
    public: true,
    summary: 'Send the verification link again; always 202',
    request: { body: forgotBody },
    status: 202,
    responses: { 202: { description: 'Accepted', schema: acceptedResponse } },
    handler: (req) => portal.resendVerification(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/login',
    tags,
    public: true,
    summary: 'Guest login (verified e-mail required)',
    request: { body: loginBody },
    responses: { 200: { description: 'Session', schema: tokenResponse } },
    handler: (req, res) => portal.login(req, res, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/refresh',
    tags,
    public: true,
    summary: 'Rotate the guest refresh cookie (X-CSRF-Token)',
    responses: { 200: { description: 'Session', schema: tokenResponse } },
    handler: (req, res) => portal.refresh(req, res),
  })
  .route({
    method: 'post',
    path: '/logout',
    tags,
    public: true,
    summary: 'Revoke the guest session',
    status: 204,
    handler: async (req, res) => {
      await portal.logout(req, res);
      res.status(204).end();
    },
  })
  .route({
    method: 'get',
    path: '/me',
    tags,
    summary: 'Current guest account and profile',
    middleware: guest,
    responses: { 200: { description: 'Guest', schema: meResponse } },
    handler: (req) => portal.me(req),
  })
  .route({
    method: 'post',
    path: '/password',
    tags,
    summary: 'Change my password',
    middleware: guest,
    request: { body: changePasswordBody },
    status: 204,
    handler: async (req, res) => {
      await portal.changePassword(req, req.valid.body);
      res.status(204).end();
    },
  })
  .route({
    method: 'post',
    path: '/password/forgot',
    tags,
    public: true,
    summary: 'Send a 30-min reset link; always 202',
    request: { body: forgotBody },
    status: 202,
    responses: { 202: { description: 'Accepted', schema: acceptedResponse } },
    handler: (req) => portal.forgotPassword(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/password/reset',
    tags,
    public: true,
    summary: 'Set a new password from a reset link',
    request: { body: resetBody },
    responses: { 200: { description: 'Done', schema: acceptedResponse } },
    handler: (req) => portal.resetPassword(req, req.valid.body),
  });
