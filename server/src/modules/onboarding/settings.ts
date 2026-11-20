import { z } from 'zod';
import { defineSetting } from '../../core/settings.js';

export const ONBOARDING_STEPS = 8;

export const onboardingStateSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'skipped']),
  /** Step to show next (0-based, 0 = Établissement … 7 = Récapitulatif). */
  step: z
    .number()
    .int()
    .min(0)
    .max(ONBOARDING_STEPS - 1),
  completedSteps: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(ONBOARDING_STEPS - 1),
    )
    .max(ONBOARDING_STEPS),
  updatedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const DEMO_ID_KEYS = [
  'rates',
  'ratePlans',
  'rooms',
  'roomTypes',
  'products',
  'guests',
] as const;
export type DemoIdKey = (typeof DEMO_ID_KEYS)[number];

export const onboardingDemoSchema = z.object({
  loaded: z.boolean(),
  loadedAt: z.string().nullable(),
  /** Ids created by "load demo data", in deletion order (children first). */
  ids: z.object({
    rates: z.array(z.string()),
    ratePlans: z.array(z.string()),
    rooms: z.array(z.string()),
    roomTypes: z.array(z.string()),
    products: z.array(z.string()),
    guests: z.array(z.string()),
  }),
});
export type OnboardingDemo = z.infer<typeof onboardingDemoSchema>;

export const EMPTY_DEMO: OnboardingDemo = {
  loaded: false,
  loadedAt: null,
  ids: { rates: [], ratePlans: [], rooms: [], roomTypes: [], products: [], guests: [] },
};

export const onboardingSettings = {
  state: defineSetting({
    key: 'onboarding.state',
    schema: onboardingStateSchema,
    default: {
      status: 'in_progress',
      step: 0,
      completedSteps: [],
      updatedAt: null,
      finishedAt: null,
    },
    scopes: ['TENANT'],
    description: 'Onboarding wizard progress of the tenant owner (TN-02).',
  }),
  demo: defineSetting({
    key: 'onboarding.demo',
    schema: onboardingDemoSchema,
    default: EMPTY_DEMO,
    scopes: ['TENANT'],
    description:
      'Ids of the demonstration data loaded by the wizard (TN-03), to delete them later.',
  }),
} as const;
