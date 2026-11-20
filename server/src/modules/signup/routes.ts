import { createModuleRouter } from '../../core/router.js';
import { ipKey, rateLimit } from '../auth/tokens.js';
import {
  publicPlansSchema,
  resendBody,
  resendResultSchema,
  signupBody,
  signupResultSchema,
  slugAvailabilitySchema,
  slugQuery,
  verifyBody,
  verifyResultSchema,
} from './schemas.js';
import * as svc from './service.js';
import { checkSlug } from './slug.js';

const tags = ['public: signup'];

/**
 * `/api/v1/public/*`: platform host only, no authentication (marketing and self-service signup).
 * Every route is rate-limited by IP; the signup adds a honeypot and an optional captcha hook.
 */
export const signupRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/plans',
    tags,
    public: true,
    summary: 'Public plans: prices per cycle, trial days, features and quotas',
    responses: { 200: { description: 'Plans', schema: publicPlansSchema } },
    handler: async (req) => {
      await rateLimit(req.services, [
        { key: `public-plans:ip:${ipKey(req)}`, limit: 120, windowS: 60 },
      ]);
      return svc.publicPlans(req.services);
    },
  })
  .route({
    method: 'get',
    path: '/slug-available',
    tags,
    public: true,
    summary: 'Is this sub-domain free (format, reserved words, existing tenants)?',
    request: { query: slugQuery },
    responses: { 200: { description: 'Availability', schema: slugAvailabilitySchema } },
    handler: async (req) => {
      await rateLimit(req.services, [
        { key: `public-slug:ip:${ipKey(req)}`, limit: 60, windowS: 60 },
      ]);
      return checkSlug(req.services, req.valid.query.slug);
    },
  })
  .route({
    method: 'post',
    path: '/signup',
    tags,
    public: true,
    summary: 'Self-service hotel signup (tenant, owner, trial subscription, verification e-mail)',
    request: { body: signupBody },
    status: 201,
    responses: { 201: { description: 'Pending e-mail verification', schema: signupResultSchema } },
    handler: (req) => svc.signup(req.services, req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/signup/verify',
    tags,
    public: true,
    summary: 'Verifies the owner e-mail, activates the account, returns the tenant login URL',
    request: { body: verifyBody },
    responses: { 200: { description: 'Verified', schema: verifyResultSchema } },
    handler: (req) => svc.verifyEmail(req.services, req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/signup/resend',
    tags,
    public: true,
    summary: 'Sends the verification e-mail again (always answers ok)',
    request: { body: resendBody },
    responses: { 200: { description: 'Accepted', schema: resendResultSchema } },
    handler: (req) => svc.resendVerification(req.services, req, req.valid.body),
  });
