import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@hm/ui';

import { apiClient } from '../auth/session';

export const TOTAL_STEPS = 8;
export const STEP_KEYS = [
  'property',
  'roomTypes',
  'rooms',
  'rates',
  'taxes',
  'team',
  'branding',
  'recap',
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface DemoCounts {
  rates: number;
  ratePlans: number;
  rooms: number;
  roomTypes: number;
  products: number;
  guests: number;
}

export interface OnboardingView {
  status: 'in_progress' | 'completed' | 'skipped';
  step: number;
  completedSteps: number[];
  updatedAt: string | null;
  finishedAt: string | null;
  demo: { loaded: boolean; loadedAt: string | null; counts: DemoCounts };
  facts: {
    propertyId: string | null;
    property: boolean;
    roomTypes: number;
    rooms: number;
    ratePlans: number;
    rates: number;
    taxes: number;
    team: boolean;
    branding: boolean;
  };
}

export interface StatePatch {
  step?: number;
  completedSteps?: number[];
  status?: OnboardingView['status'];
}

export const onboardingKey = ['onboarding'] as const;

export const getOnboarding = () => apiClient.get<OnboardingView>('/onboarding');
export const patchOnboarding = (patch: StatePatch) =>
  apiClient.put<OnboardingView>('/onboarding', patch);
export const loadDemoData = () => apiClient.post<OnboardingView['demo']>('/onboarding/demo-data');
export const deleteDemoData = () =>
  apiClient.delete<{ removed: DemoCounts }>('/onboarding/demo-data');

/** Wizard state of the owner; only queried when `enabled` (settings.manage). */
export function useOnboarding(enabled: boolean) {
  return useQuery({ queryKey: onboardingKey, queryFn: getOnboarding, enabled, retry: false });
}

/** Per-step "done" flags used by the checklist (stored progress OR what already exists). */
export function checklistOf(v: OnboardingView): Record<Exclude<StepKey, 'recap'>, boolean> {
  const c = new Set(v.completedSteps);
  return {
    property: c.has(0) || v.facts.property,
    roomTypes: c.has(1) || v.facts.roomTypes > 0,
    rooms: c.has(2) || v.facts.rooms > 0,
    rates: c.has(3) || v.facts.rates > 0,
    taxes: c.has(4) || v.facts.taxes > 0,
    team: c.has(5) || v.facts.team,
    branding: c.has(6) || v.facts.branding,
  };
}

export interface QuotaMeta {
  quota?: string;
  limit?: number;
  used?: number;
}

/** `{ limit, used }` of a QUOTA_EXCEEDED answer, if that is what the error is. */
export function quotaOf(e: unknown): QuotaMeta | null {
  if (e instanceof ApiError && e.code === 'QUOTA_EXCEEDED') return (e.meta ?? {}) as QuotaMeta;
  return null;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}
