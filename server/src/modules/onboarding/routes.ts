import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { recordAudit } from '../../middleware/audit.js';
import { withCtx } from '../property/common.js';
import * as service from './service.js';
import { DEMO_ID_KEYS, ONBOARDING_STEPS, onboardingStateSchema } from './settings.js';

const tags = ['onboarding'];
const guard = [can('settings.manage'), requireFeature('lodging.core')];

const step = z
  .number()
  .int()
  .min(0)
  .max(ONBOARDING_STEPS - 1);

const patchBody = z
  .object({
    step: step.optional(),
    completedSteps: z.array(step).max(ONBOARDING_STEPS).optional(),
    status: onboardingStateSchema.shape.status.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const demoCounts = z.object(
  Object.fromEntries(DEMO_ID_KEYS.map((k) => [k, z.number().int()])) as Record<
    (typeof DEMO_ID_KEYS)[number],
    z.ZodNumber
  >,
);
const demoSchema = z.object({
  loaded: z.boolean(),
  loadedAt: z.string().nullable(),
  counts: demoCounts,
});

const viewSchema = onboardingStateSchema.extend({
  demo: demoSchema,
  facts: z.object({
    propertyId: z.string().nullable(),
    property: z.boolean(),
    roomTypes: z.number().int(),
    rooms: z.number().int(),
    ratePlans: z.number().int(),
    rates: z.number().int(),
    taxes: z.number().int(),
    team: z.boolean(),
    branding: z.boolean(),
  }),
});

/** Staff API `/api/v1/t/onboarding` — setup wizard state and demonstration data (TN-02, TN-03). */
export const onboardingRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'Wizard progress, demo data status and what is already configured',
    middleware: guard,
    responses: { 200: { description: 'State', schema: viewSchema } },
    handler: (req) => withCtx(req, (ctx) => service.getOnboarding(ctx)),
  })
  .route({
    method: 'put',
    path: '/',
    tags,
    summary: 'Saves the wizard progress (current step, completed steps, finished / skipped)',
    middleware: guard,
    request: { body: patchBody },
    responses: { 200: { description: 'State', schema: onboardingStateSchema } },
    handler: async (req) => {
      const state = await withCtx(req, (ctx) => service.updateOnboarding(ctx, req.valid.body));
      if (req.valid.body.status)
        recordAudit(req, {
          action: `onboarding.${req.valid.body.status}`,
          entity: 'onboarding',
          after: { step: state.step, completedSteps: state.completedSteps },
        });
      return state;
    },
  })
  .route({
    method: 'post',
    path: '/demo-data',
    tags,
    summary: 'Loads fictional demonstration data (quota `units` applies to the rooms)',
    middleware: guard,
    status: 201,
    responses: { 201: { description: 'Loaded', schema: demoSchema } },
    handler: async (req) => {
      const demo = await withCtx(req, (ctx) => service.loadDemoData(ctx));
      recordAudit(req, {
        action: 'onboarding.demo_loaded',
        entity: 'onboarding',
        after: demo.counts,
      });
      return demo;
    },
  })
  .route({
    method: 'delete',
    path: '/demo-data',
    tags,
    summary: 'Deletes exactly the demonstration data loaded by the wizard',
    middleware: guard,
    responses: { 200: { description: 'Deleted', schema: z.object({ removed: demoCounts }) } },
    handler: async (req) => {
      const out = await withCtx(req, (ctx) => service.deleteDemoData(ctx));
      recordAudit(req, {
        action: 'onboarding.demo_deleted',
        entity: 'onboarding',
        after: out.removed,
      });
      return out;
    },
  });
