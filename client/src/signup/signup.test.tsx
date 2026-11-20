import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { json } from '../test-utils';
import { CheckEmailPage } from './CheckEmailPage';
import { LandingPage } from './LandingPage';
import { SignupFormPage } from './SignupFormPage';
import { VerifyPage } from './VerifyPage';
import { SLUG_DEBOUNCE_MS, slugify, type PublicPlan } from './api';

const PLANS: PublicPlan[] = [
  plan('STANDARD', 'Standard', 14, 25000, 71250, 255000, { units: 20, users: 5 }),
  plan('MEDIUM', 'Medium', 14, 50000, 142500, 510000, { units: 60, users: 15 }),
  plan('PREMIUM', 'Premium', 30, 100000, 285000, 1020000, { units: null, users: null }),
];

function plan(
  code: string,
  name: string,
  trialDays: number,
  m: number,
  q: number,
  y: number,
  quotas: Record<string, number | null>,
): PublicPlan {
  return {
    code,
    name,
    description: null,
    trialDays,
    features: ['lodging.core', 'billing.core'],
    quotas,
    prices: [
      { billingCycle: 'MONTHLY', currency: 'XOF', amount: m },
      { billingCycle: 'QUARTERLY', currency: 'XOF', amount: q },
      { billingCycle: 'YEARLY', currency: 'XOF', amount: y },
    ],
  };
}

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}
let calls: Call[];
let taken: Set<string>;
let signupResponse: () => Response;
let verifyResponse: () => Response;

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  calls = [];
  taken = new Set(['occupe']);
  signupResponse = () =>
    json(201, { status: 'pending_verification', email: 'ama@hotel.test', host: 'x' });
  verifyResponse = () =>
    json(200, {
      loginUrl: 'https://lac.hm.test/login?verified=1',
      host: 'lac.hm.test',
      email: 'ama@hotel.test',
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api/v1/public', '');
      const method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (path === '/plans') return json(200, { items: PLANS });
      if (path.startsWith('/slug-available')) {
        const slug = new URL(`http://x${path}`).searchParams.get('slug') ?? '';
        return json(
          200,
          taken.has(slug) ? { slug, available: false, reason: 'TAKEN' } : { slug, available: true },
        );
      }
      if (path === '/signup') return signupResponse();
      if (path === '/signup/verify') return verifyResponse();
      if (path === '/signup/resend') return json(200, { status: 'ok' });
      return json(404, { title: 'Not found', code: 'NOT_FOUND' });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/signup" element={<LandingPage />} />
          <Route path="/signup/new" element={<SignupFormPage />} />
          <Route path="/signup/check-email" element={<CheckEmailPage />} />
          <Route path="/signup/verify" element={<VerifyPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const slugCalls = () => calls.filter((c) => c.path.startsWith('/slug-available'));

async function fillValid(over: { slug?: string } = {}) {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText("Nom de l'hôtel"), 'Hôtel du Lac');
  if (over.slug !== undefined) {
    await u.clear(screen.getByLabelText('Adresse web de votre espace'));
    await u.type(screen.getByLabelText('Adresse web de votre espace'), over.slug);
  }
  await u.type(screen.getByLabelText('Ville'), 'Lomé');
  await u.type(screen.getByLabelText('Votre nom complet'), 'Ama Kodjo');
  await u.type(screen.getByLabelText('Adresse e-mail professionnelle'), 'ama@hotel.test');
  await u.type(screen.getByLabelText(/^Téléphone/), '90 12 34 56');
  await u.type(screen.getByLabelText('Mot de passe'), 'Correct-Horse-9');
  await u.click(screen.getByRole('checkbox', { name: /conditions générales/ }));
  await u.click(screen.getByRole('checkbox', { name: /accord de traitement/ }));
  return u;
}

describe('slugify', () => {
  it('builds a clean sub-domain from a hotel name', () => {
    expect(slugify('Hôtel du Lac, Lomé !')).toBe('hotel-du-lac-lome');
    expect(slugify('  --Ça--va--  ')).toBe('ca-va');
    expect(slugify('x'.repeat(80))).toHaveLength(48);
  });
});

describe('landing page', () => {
  it('shows the three plans with their prices, trial and quotas, and the cycle switch', async () => {
    renderAt('/signup');
    for (const name of ['Standard', 'Medium', 'Premium'])
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    const std = screen.getByTestId('plan-STANDARD');
    expect(within(std).getByText(/25\s000\sFCFA/)).toBeInTheDocument();
    expect(within(std).getByText('14 jours d’essai gratuit'.replace('’', "'"))).toBeInTheDocument();
    expect(
      within(screen.getByTestId('plan-PREMIUM')).getAllByText('Illimité').length,
    ).toBeGreaterThan(0);
    await userEvent.click(screen.getByText('Annuel'));
    expect(within(std).getByText(/255\s000\sFCFA/)).toBeInTheDocument();
    expect(within(std).getByText('par an')).toBeInTheDocument();
  });

  it('carries the chosen plan and cycle to the signup form', async () => {
    renderAt('/signup');
    await userEvent.click(screen.getByText('Trimestriel'));
    await userEvent.click(await screen.findByRole('button', { name: /Choisir Medium/ }));
    expect(
      await screen.findByRole('heading', { name: 'Créer mon espace hôtel' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Medium')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Trimestriel/ })).toBeChecked();
  });
});

describe('signup form validation', () => {
  it('shows the field errors and does not call the API when the form is empty', async () => {
    renderAt('/signup/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Créer mon espace' }));
    expect(
      await screen.findByText("Saisissez le nom de l'hôtel (2 caractères minimum)."),
    ).toBeInTheDocument();
    expect(screen.getByText('Choisissez une adresse web valide.')).toBeInTheDocument();
    expect(screen.getByText('Saisissez votre nom.')).toBeInTheDocument();
    expect(screen.getByText('Saisissez une adresse e-mail valide.')).toBeInTheDocument();
    expect(screen.getByText(/Saisissez un numéro valide/)).toBeInTheDocument();
    expect(screen.getByText('Saisissez la ville.')).toBeInTheDocument();
    expect(screen.getByText('10 caractères minimum.')).toBeInTheDocument();
    expect(screen.getByText('Vous devez accepter les conditions générales.')).toBeInTheDocument();
    expect(
      screen.getByText("Vous devez accepter l'accord de traitement des données."),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/signup')).toBe(false);
  });

  it('requires a password mixing at least three character classes', async () => {
    renderAt('/signup/new');
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Mot de passe'), 'abcdefghijkl');
    await u.click(screen.getByRole('button', { name: 'Créer mon espace' }));
    expect(await screen.findByText(/Mélangez au moins 3 types/)).toBeInTheDocument();
  });

  it('derives the web address from the hotel name until it is edited', async () => {
    renderAt('/signup/new');
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Nom de l'hôtel"), 'Hôtel du Lac');
    expect(screen.getByLabelText('Adresse web de votre espace')).toHaveValue('hotel-du-lac');
    await u.clear(screen.getByLabelText('Adresse web de votre espace'));
    await u.type(screen.getByLabelText('Adresse web de votre espace'), 'lac-lome');
    await u.type(screen.getByLabelText("Nom de l'hôtel"), ' 2');
    expect(screen.getByLabelText('Adresse web de votre espace')).toHaveValue('lac-lome');
  });
});

describe('live slug check', () => {
  it('waits for a pause in typing: a single request for the final value', async () => {
    renderAt('/signup/new');
    const u = userEvent.setup({ delay: null });
    const input = await screen.findByLabelText('Adresse web de votre espace');
    await u.type(input, 'ma-belle-villa');
    expect(slugCalls()).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Vérification…');
    await waitFor(() => expect(slugCalls()).toHaveLength(1), { timeout: SLUG_DEBOUNCE_MS + 1500 });
    expect(slugCalls()[0]?.path).toBe('/slug-available?slug=ma-belle-villa');
    expect(await screen.findByText(/Disponible/)).toHaveTextContent(/ma-belle-villa\./);
    // Idle: nothing else is sent.
    await new Promise((r) => setTimeout(r, SLUG_DEBOUNCE_MS + 100));
    expect(slugCalls()).toHaveLength(1);
  });

  it('reports a taken address and blocks the submit button', async () => {
    renderAt('/signup/new');
    const u = userEvent.setup({ delay: null });
    await u.type(await screen.findByLabelText('Adresse web de votre espace'), 'occupe');
    expect(
      await screen.findByText('Cette adresse est déjà utilisée.', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer mon espace' })).toBeDisabled();
  });

  it('flags a badly formed address without calling the server', async () => {
    renderAt('/signup/new');
    const u = userEvent.setup({ delay: null });
    await u.type(await screen.findByLabelText('Adresse web de votre espace'), 'Mauvais_Nom');
    expect(screen.getByText(/Format invalide/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, SLUG_DEBOUNCE_MS + 100));
    expect(slugCalls()).toHaveLength(0);
  });
});

describe('signup submission', () => {
  it('posts the form without the honeypot and shows the check-your-email page', async () => {
    renderAt('/signup/new?plan=MEDIUM&cycle=YEARLY');
    await screen.findByText('Medium');
    const u = await fillValid({ slug: 'lac-lome' });
    await u.click(screen.getByRole('button', { name: 'Créer mon espace' }));
    expect(
      await screen.findByRole('heading', { name: 'Vérifiez votre boîte e-mail' }),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.path === '/signup');
    expect(post?.body).toMatchObject({
      hotelName: 'Hôtel du Lac',
      slug: 'lac-lome',
      ownerName: 'Ama Kodjo',
      email: 'ama@hotel.test',
      phone: '90 12 34 56',
      country: 'TG',
      city: 'Lomé',
      planCode: 'MEDIUM',
      cycle: 'YEARLY',
      acceptTerms: true,
      acceptDpa: true,
      locale: 'fr',
    });
    expect(post?.body).not.toHaveProperty('website');
    expect(screen.getByText(/ama@hotel\.test/)).toBeInTheDocument();
  });

  it('sends the honeypot when a bot fills it', async () => {
    renderAt('/signup/new?plan=STANDARD');
    await screen.findByText('Standard');
    const u = await fillValid({ slug: 'lac-lome' });
    const trap = document.getElementById('website') as HTMLInputElement;
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap).toHaveAttribute('tabindex', '-1');
    await u.type(trap, 'http://spam.example');
    await u.click(screen.getByRole('button', { name: 'Créer mon espace' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/signup')).toBe(true));
    expect(calls.find((c) => c.path === '/signup')?.body).toMatchObject({
      website: 'http://spam.example',
    });
  });

  it('maps server-side errors (taken slug, bad phone) onto the fields', async () => {
    signupResponse = () =>
      json(409, {
        title: 'Conflict',
        code: 'CONFLICT',
        status: 409,
        meta: { reason: 'SLUG_TAKEN', field: 'slug' },
      });
    renderAt('/signup/new?plan=STANDARD');
    await screen.findByText('Standard');
    const u = await fillValid({ slug: 'lac-lome' });
    await u.click(screen.getByRole('button', { name: 'Créer mon espace' }));
    expect(await screen.findByText('Cette adresse web est déjà utilisée.')).toBeInTheDocument();

    signupResponse = () =>
      json(422, {
        title: 'Validation failed',
        code: 'VALIDATION_ERROR',
        status: 422,
        errors: [{ path: 'phone', code: 'PHONE_INVALID', message: 'Invalid phone number' }],
      });
    await u.click(screen.getByRole('button', { name: /Créer mon espace/ }));
    expect(await screen.findByText('Numéro de téléphone invalide.')).toBeInTheDocument();
  });
});

describe('check-email and verification pages', () => {
  it('check-email explains what to do and offers a delayed resend', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/signup/check-email',
              state: { email: 'ama@hotel.test', host: 'lac.hm.test', slug: 'lac' },
            },
          ]}
        >
          <Routes>
            <Route path="/signup/check-email" element={<CheckEmailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/ama@hotel\.test/)).toBeInTheDocument();
    expect(screen.getByText(/lac\.hm\.test/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Renvoi possible dans/ })).toBeDisabled();
  });

  it('verifies the token once and links to the tenant login', async () => {
    renderAt('/signup/verify?token=abcdefghijklmnop');
    expect(await screen.findByText('Votre espace est activé')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Me connecter' })).toHaveAttribute(
      'href',
      'https://lac.hm.test/login?verified=1',
    );
    expect(calls.filter((c) => c.path === '/signup/verify')).toHaveLength(1);
    expect(calls.find((c) => c.path === '/signup/verify')?.body).toEqual({
      token: 'abcdefghijklmnop',
    });
  });

  it('explains an invalid or expired link, and a missing token', async () => {
    verifyResponse = () =>
      json(422, { title: 'Validation failed', code: 'VALIDATION_ERROR', status: 422 });
    const first = renderAt('/signup/verify?token=abcdefghijklmnop');
    expect(await screen.findByText('Lien invalide ou expiré')).toBeInTheDocument();
    first.unmount();
    renderAt('/signup/verify');
    expect(await screen.findByText('Lien de confirmation incomplet.')).toBeInTheDocument();
  });
});
