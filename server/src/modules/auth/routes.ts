import type { RequestHandler } from 'express';
import { createModuleRouter } from '../../core/router.js';
import { anyStaff, requireAuth } from '../../http/helpers.js';
import {
  acceptedResponse,
  backupCodesResponse,
  changePasswordBody,
  forgotBody,
  idParams,
  inviteAcceptBody,
  inviteInspectBody,
  loginBody,
  loginResponse,
  meResponse,
  mfaActivateBody,
  mfaActivateResponse,
  mfaSetupBody,
  mfaSetupResponse,
  mfaVerifyBody,
  passwordConfirmBody,
  resetBody,
  sessionsResponse,
  tokenResponse,
} from './schemas.js';
import * as auth from './service.js';

const tags = ['auth'];
/** Every authenticated route of the module: staff token required (module auth is optional). */
const staff: RequestHandler[] = [requireAuth('staff'), anyStaff()];

/** Staff authentication `/api/v1/t/auth` (doc 05 §1, doc 01 TN-12…TN-16). */
export const authRouter = createModuleRouter()
  .route({
    method: 'post',
    path: '/login',
    tags,
    public: true,
    summary: 'Log in with e-mail + password (may return an MFA challenge)',
    request: { body: loginBody },
    responses: { 200: { description: 'Session or MFA challenge', schema: loginResponse } },
    handler: (req, res) => auth.login(req, res, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/mfa/verify',
    tags,
    public: true,
    summary: 'Complete a login with a TOTP or backup code',
    request: { body: mfaVerifyBody },
    responses: { 200: { description: 'Session', schema: tokenResponse } },
    handler: (req, res) => auth.verifyMfa(req, res, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/mfa/setup',
    tags,
    public: true,
    summary: 'Start TOTP enrolment (bearer, or mfa_setup challenge when MFA is mandatory)',
    request: { body: mfaSetupBody },
    responses: { 200: { description: 'Secret and otpauth URI', schema: mfaSetupResponse } },
    handler: (req) => auth.mfaSetup(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/mfa/activate',
    tags,
    public: true,
    summary: 'Confirm TOTP enrolment with a first code; returns 10 backup codes',
    request: { body: mfaActivateBody },
    responses: { 200: { description: 'Backup codes (+ session)', schema: mfaActivateResponse } },
    handler: (req, res) => auth.mfaActivate(req, res, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/mfa/disable',
    tags,
    summary: 'Disable TOTP (refused when mandatory for the role)',
    middleware: staff,
    request: { body: passwordConfirmBody },
    status: 204,
    handler: async (req, res) => {
      await auth.mfaDisable(req, req.valid.body);
      res.status(204).end();
    },
  })
  .route({
    method: 'post',
    path: '/mfa/backup-codes',
    tags,
    summary: 'Regenerate the 10 backup codes',
    middleware: staff,
    request: { body: passwordConfirmBody },
    responses: { 200: { description: 'New backup codes', schema: backupCodesResponse } },
    handler: (req) => auth.mfaBackupCodes(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/refresh',
    tags,
    public: true,
    summary: 'Rotate the refresh cookie (X-CSRF-Token required); reuse revokes the family',
    responses: { 200: { description: 'New access token', schema: tokenResponse } },
    handler: (req, res) => auth.refresh(req, res),
  })
  .route({
    method: 'post',
    path: '/logout',
    tags,
    public: true,
    summary: 'Revoke the current session and clear cookies',
    status: 204,
    handler: async (req, res) => {
      await auth.logout(req, res);
      res.status(204).end();
    },
  })
  .route({
    method: 'get',
    path: '/me',
    tags,
    summary: 'Current user, tenant, properties, effective permissions and entitlements',
    middleware: staff,
    responses: { 200: { description: 'Caller', schema: meResponse } },
    handler: (req) => auth.me(req),
  })
  .route({
    method: 'get',
    path: '/sessions',
    tags,
    summary: 'My active sessions',
    middleware: staff,
    responses: { 200: { description: 'Sessions', schema: sessionsResponse } },
    handler: (req) => auth.listSessions(req),
  })
  .route({
    method: 'delete',
    path: '/sessions/:id',
    tags,
    summary: 'Revoke one of my sessions',
    middleware: staff,
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      await auth.revokeSession(req, req.valid.params.id);
      res.status(204).end();
    },
  })
  .route({
    method: 'post',
    path: '/password',
    tags,
    summary: 'Change my password (policy + history); other sessions are revoked',
    middleware: staff,
    request: { body: changePasswordBody },
    responses: { 200: { description: 'New access token', schema: tokenResponse } },
    handler: (req) => auth.changePassword(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/password/forgot',
    tags,
    public: true,
    summary: 'Send a single-use reset link (30 min); always 202',
    request: { body: forgotBody },
    status: 202,
    responses: { 202: { description: 'Accepted', schema: acceptedResponse } },
    handler: (req) => auth.forgotPassword(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/password/reset',
    tags,
    public: true,
    summary: 'Set a new password from a reset link; every session is revoked',
    request: { body: resetBody },
    responses: { 200: { description: 'Done', schema: acceptedResponse } },
    handler: (req) => auth.resetPassword(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/invitations/inspect',
    tags,
    public: true,
    summary: 'Read an invitation (e-mail, name) before accepting it',
    request: { body: inviteInspectBody },
    handler: (req) => auth.inspectInvitation(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/invitations/accept',
    tags,
    public: true,
    summary: 'Accept an invitation: set the password and activate the account',
    request: { body: inviteAcceptBody },
    handler: (req) => auth.acceptInvitation(req, req.valid.body),
  });
