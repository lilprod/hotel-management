import { useEffect, useState } from 'react';

import { createApiClient } from '@hm/ui';

/** Public API (`/api/v1/public`, platform host, no authentication): plans, slug check, signup. */
export const publicClient = createApiClient({ baseUrl: '/api/v1/public' });

const opts = { skipAuth: true } as const;

export type Cycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export const CYCLES: readonly Cycle[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];

export interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  trialDays: number;
  features: string[];
  quotas: Record<string, number | null>;
  prices: { billingCycle: Cycle; currency: string; amount: number }[];
}

export type SlugReason = 'INVALID' | 'RESERVED' | 'TAKEN';
export interface SlugCheck {
  slug: string;
  available: boolean;
  reason?: SlugReason;
}

export interface SignupInput {
  hotelName: string;
  slug: string;
  ownerName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  planCode: string;
  cycle: Cycle;
  password: string;
  acceptTerms: true;
  acceptDpa: true;
  locale: 'fr' | 'en';
  website?: string;
}

export interface SignupResult {
  status: 'pending_verification';
  email: string;
  host: string;
}

export const fetchPlans = () => publicClient.get<{ items: PublicPlan[] }>('/plans', opts);
export const checkSlug = (slug: string) =>
  publicClient.get<SlugCheck>(`/slug-available?slug=${encodeURIComponent(slug)}`, opts);
export const submitSignup = (body: SignupInput) =>
  publicClient.post<SignupResult>('/signup', body, opts);
export const verifyEmail = (token: string) =>
  publicClient.post<{ loginUrl: string; host: string; email: string }>(
    '/signup/verify',
    { token },
    opts,
  );
export const resendVerification = (slug: string, email: string) =>
  publicClient.post<{ status: 'ok' }>('/signup/resend', { slug, email }, opts);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
export const SLUG_DEBOUNCE_MS = 400;

/** "Hôtel du Lac, Lomé" → "hotel-du-lac-lome". */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

/** Returns `value` once it stopped changing for `delay` ms. */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export type SlugState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: SlugReason }
  | { kind: 'unknown' };

/**
 * Live availability of the sub-domain: only well-formed slugs are sent to the server, after a
 * pause in typing; the answer of an outdated slug is dropped.
 */
export function useSlugAvailability(slug: string): SlugState {
  const debounced = useDebounced(slug, SLUG_DEBOUNCE_MS);
  const [result, setResult] = useState<{ slug: string; state: SlugState } | null>(null);
  const wellFormed = SLUG_RE.test(debounced) && !debounced.includes('--');

  useEffect(() => {
    if (!wellFormed) return;
    let cancelled = false;
    checkSlug(debounced).then(
      (r) => {
        if (cancelled) return;
        setResult({
          slug: debounced,
          state: r.available
            ? { kind: 'available' }
            : { kind: 'unavailable', reason: r.reason ?? 'INVALID' },
        });
      },
      () => {
        if (!cancelled) setResult({ slug: debounced, state: { kind: 'unknown' } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [debounced, wellFormed]);

  if (slug.length < 3 && /^[a-z0-9-]*$/.test(slug)) return { kind: 'idle' };
  if (!SLUG_RE.test(slug) || slug.includes('--')) return { kind: 'unavailable', reason: 'INVALID' };
  if (slug !== debounced || !wellFormed || result?.slug !== slug) return { kind: 'checking' };
  return result.state;
}
