import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore, useUiStore } from '@hm/ui/core';

import { App } from './App';
import { apiClient, applyMe, useMeStore } from './auth/session';
import type { PortalMe } from './auth/session';
import i18n from './i18n';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  resetSchema,
} from './pages/auth/AuthPages';

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ME: PortalMe = {
  account: {
    id: 'a1',
    email: 'ama@example.com',
    locale: 'fr',
    emailVerified: true,
    lastLoginAt: '2026-01-10T09:30:00Z',
  },
  guest: { id: 'g1', firstName: 'Ama', lastName: 'Kossi', phone: '+228 90 00 00 00', email: null },
  tenant: { id: 't1', slug: 'demo', name: 'Hôtel Démo' },
};
const TOKENS = { accessToken: 'at-1', tokenType: 'Bearer', expiresIn: 900, csrfToken: 'c1' };

/** Stubs `fetch` with a route table (`"METHOD /path-suffix"` → response factory). */
function stubApi(routes: Record<string, (body: unknown) => Response>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      const key = Object.keys(routes).find((k) => {
        const [m, suffix] = k.split(' ') as [string, string];
        return m === method && url.split('?')[0]!.endsWith(suffix);
      });
      return key ? routes[key]!(body) : json(404, { title: 'Not found', code: 'NOT_FOUND' });
    }),
  );
  return calls;
}

function signOut() {
  apiClient.setAccessToken(null, null);
  useMeStore.setState({ me: null });
  useSessionStore.getState().clearSession();
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => vi.unstubAllGlobals());

describe('validation schemas', () => {
  it('login requires a valid e-mail and a password', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('register applies the guest password policy (8 chars min) and trims names', () => {
    const base = { firstName: ' Ama ', lastName: 'Kossi', email: 'a@b.co', password: 'abcdefg1' };
    expect(registerSchema.safeParse({ ...base, password: 'short1' }).success).toBe(false);
    const ok = registerSchema.safeParse(base);
    expect(ok.success && ok.data.firstName).toBe('Ama');
    expect(registerSchema.safeParse({ ...base, firstName: '  ' }).success).toBe(false);
  });

  it('reset / change password require matching confirmations', () => {
    expect(resetSchema.safeParse({ newPassword: 'abcdefg1', confirm: 'abcdefg2' }).success).toBe(
      false,
    );
    expect(resetSchema.safeParse({ newPassword: 'abcdefg1', confirm: 'abcdefg1' }).success).toBe(
      true,
    );
    expect(
      changePasswordSchema.safeParse({
        currentPassword: '',
        newPassword: 'abcdefg1',
        confirm: 'abcdefg1',
      }).success,
    ).toBe(false);
  });
});

describe('register page', () => {
  it('shows the validation errors and sends nothing when the form is invalid', async () => {
    const user = userEvent.setup();
    const calls = stubApi({});
    renderApp('/account/register');
    await user.click(await screen.findByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findAllByText('Ce champ est obligatoire.')).toHaveLength(2);
    expect(screen.getByText('Saisissez une adresse e-mail valide.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('registers, then confirms that a verification e-mail was sent', async () => {
    const user = userEvent.setup();
    const calls = stubApi({ 'POST /auth/register': () => json(202, { accepted: true }) });
    renderApp('/account/register');
    await user.type(await screen.findByLabelText('Prénom'), 'Ama');
    await user.type(screen.getByLabelText('Nom'), 'Kossi');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'ama@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'Secret-1234');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Vérifiez votre boîte mail' }),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith('/auth/register'));
    expect(post?.url).toBe('/api/v1/portal/auth/register');
    expect(post?.body).toMatchObject({ email: 'ama@example.com', locale: 'fr' });
  });
});

describe('login flow', () => {
  it('logs in then lands on the profile page with the guest details', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      'POST /auth/login': () => json(200, TOKENS),
      'GET /auth/me': () => json(200, ME),
    });
    renderApp('/account');
    // guarded: anonymous visitors are sent to the login page
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'ama@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'Secret-1234');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Bonjour Ama, heureux de vous revoir.')).toBeInTheDocument();
    expect(screen.getByText('Kossi')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/auth/login'))?.body).toEqual({
      email: 'ama@example.com',
      password: 'Secret-1234',
    });
    // tokens stay in memory
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('at-1');
  });

  it('offers to resend the verification e-mail when the address is not verified', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      'POST /auth/login': () =>
        json(403, { code: 'FORBIDDEN', title: 'x', meta: { reason: 'EMAIL_NOT_VERIFIED' } }),
      'POST /auth/verify-email/resend': () => json(202, { accepted: true }),
    });
    renderApp('/account/login');
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'ama@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'Secret-1234');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText(/pas encore confirmée/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Renvoyer le lien' }));
    expect(await screen.findByText(/un nouvel e-mail vient d'être envoyé/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/resend'))?.body).toEqual({
      email: 'ama@example.com',
    });
  });

  it('shows the translated error of refused credentials', async () => {
    const user = userEvent.setup();
    stubApi({
      'POST /auth/login': () =>
        json(401, { code: 'UNAUTHENTICATED', title: 'Invalid credentials' }),
    });
    renderApp('/account/login');
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'ama@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(
      await screen.findByText('Identifiants invalides ou session expirée.'),
    ).toBeInTheDocument();
  });
});

describe('verify e-mail, reset, logout', () => {
  it('confirms the address from the e-mailed token', async () => {
    const calls = stubApi({ 'POST /auth/verify-email': () => json(200, { accepted: true }) });
    renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText(/Votre adresse e-mail est confirmée/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/verify-email'))?.body).toEqual({
      token: 'abcdefghijklmnopqrstuvwxyz',
    });
  });

  it('shows an invalid-link message and a resend form when the token is refused', async () => {
    stubApi({
      'POST /auth/verify-email': () =>
        json(400, { code: 'BAD_REQUEST', title: 'x', meta: { reason: 'TOKEN_INVALID' } }),
    });
    renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText('Ce lien est invalide ou a expiré.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renvoyer le lien' })).toBeInTheDocument();
  });

  it('resets the password from the e-mailed link', async () => {
    const user = userEvent.setup();
    const calls = stubApi({ 'POST /auth/password/reset': () => json(200, { accepted: true }) });
    renderApp('/account/reset-password?token=abcdefghijklmnopqrstuvwxyz');
    await user.type(
      await screen.findByLabelText('Nouveau mot de passe', { selector: 'input' }),
      'Secret-1234',
    );
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'Different-1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      await screen.findByText('Les deux mots de passe ne correspondent pas.'),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Confirmer le mot de passe'));
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'Secret-1234');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/Mot de passe modifié/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/password/reset'))?.body).toEqual({
      token: 'abcdefghijklmnopqrstuvwxyz',
      newPassword: 'Secret-1234',
    });
  });

  it('logs out: revokes the session and returns to the login page', async () => {
    const user = userEvent.setup();
    apiClient.setAccessToken('t', 'c');
    applyMe(ME);
    const calls = stubApi({ 'POST /auth/logout': () => json(204, null) });
    renderApp('/account');
    await user.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.getAccessToken()).toBeNull());
    expect(calls.some((c) => c.url.endsWith('/auth/logout'))).toBe(true);
  });
});
