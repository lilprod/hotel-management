import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '@hm/ui';

import { permissionsForRole } from './auth/session';
import i18n from './i18n';
import { handoffUrl } from './pages/impersonations/ImpersonationsPage';
import { platformAuditQuery } from './pages/audit/PlatformAuditPage';
import { json, meOf, renderApp, signInAs, signOut, stubApi } from './test-utils';

const TOKENS = { accessToken: 'at-1', tokenType: 'Bearer', expiresIn: 900, csrfToken: 'c1' };

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => vi.unstubAllGlobals());

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Adresse e-mail'), 'root@example.com');
  await user.type(screen.getByLabelText('Mot de passe'), 'Secret-123456!');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));
}

describe('platform login (TOTP mandatory)', () => {
  it('goes password → TOTP → session, tokens stay in memory', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      'POST /auth/login': () => json(200, { mfaRequired: true, challengeToken: 'challenge-123' }),
      'POST /auth/mfa/verify': () => json(200, TOKENS),
      'GET /auth/me': () => json(200, meOf('SUPER_ADMIN')),
    });
    renderApp('/dashboard');
    await fillCredentials(user);
    expect(
      await screen.findByRole('heading', { name: 'Vérification en deux étapes' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code de vérification'), '123456');
    await user.click(screen.getByRole('button', { name: /Vérifier/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tableau de bord' }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/mfa/verify'))?.body).toEqual({
      challengeToken: 'challenge-123',
      code: '123456',
    });
    expect(calls.every((c) => c.url.startsWith('/api/v1/admin/'))).toBe(true);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('at-1');
  });

  it('forces the first-time TOTP enrolment: QR code then backup codes', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      'POST /auth/login': () =>
        json(200, { mfaSetupRequired: true, challengeToken: 'setup-challenge-123' }),
      'POST /auth/mfa/setup': () =>
        json(200, {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/HM:root@example.com?secret=JBSWY3DPEHPK3PXP&issuer=HM',
          expiresInSeconds: 600,
        }),
      'POST /auth/mfa/activate': () =>
        json(200, { ...TOKENS, backupCodes: ['AAAA-1111', 'BBBB-2222'] }),
      'GET /auth/me': () => json(200, meOf('SUPER_ADMIN')),
    });
    renderApp('/login');
    await fillCredentials(user);
    const qr = await screen.findByRole('img', { name: /QR code/ });
    await waitFor(() => expect(qr.querySelector('svg')).not.toBeNull());
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '654321');
    await user.click(await screen.findByRole('button', { name: /Activer/ }));
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/mfa/activate'))?.body).toEqual({
      code: '654321',
      challengeToken: 'setup-challenge-123',
    });
    await user.click(screen.getByRole('button', { name: /continuer/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tableau de bord' }),
    ).toBeInTheDocument();
  });

  it('shows the translated error of a refused login', async () => {
    const user = userEvent.setup();
    stubApi({
      'POST /auth/login': () =>
        json(401, { code: 'UNAUTHENTICATED', title: 'Invalid credentials' }),
    });
    renderApp('/login');
    await fillCredentials(user);
    expect(
      await screen.findByText('Identifiants invalides ou session expirée.'),
    ).toBeInTheDocument();
  });
});

describe('guards and role based menu', () => {
  it('redirects an anonymous visitor to /login', async () => {
    renderApp('/platform-users');
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it.each([
    ['SUPER_ADMIN', ['Utilisateurs plateforme', 'Impersonation', "Journal d'audit", 'Paramètres']],
    ['FINANCE', ['Factures', "Journal d'audit"]],
    ['SUPPORT', ['Support', 'Impersonation']],
    ['READ_ONLY', ['Établissements', 'Impersonation']],
  ] as const)('%s sees the expected modules', (role, shown) => {
    signInAs(role);
    renderApp('/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    for (const label of shown) expect(within(nav).getByText(label)).toBeInTheDocument();
    if (role !== 'SUPER_ADMIN') {
      expect(within(nav).queryByText('Utilisateurs plateforme')).not.toBeInTheDocument();
    }
  });

  it('shows the forbidden page when a non super admin opens platform users', async () => {
    signInAs('SUPPORT');
    renderApp('/platform-users');
    expect(await screen.findByText('Module indisponible')).toBeInTheDocument();
  });

  it('keeps start-impersonation permission to SUPPORT / SUPER_ADMIN', () => {
    expect(permissionsForRole('SUPPORT')).toContain('platform.impersonations.start');
    expect(permissionsForRole('READ_ONLY')).not.toContain('platform.impersonations.start');
    expect(permissionsForRole('FINANCE')).not.toContain('platform.impersonations.start');
  });
});

describe('platform users', () => {
  it('validates the creation form then posts it', async () => {
    const user = userEvent.setup();
    signInAs('SUPER_ADMIN');
    const calls = stubApi({
      'GET /platform-users': () => json(200, { items: [] }),
      'POST /platform-users': () => json(201, { id: 'x' }),
    });
    renderApp('/platform-users');
    await user.click(await screen.findByRole('button', { name: /Nouvel utilisateur/ }));
    await user.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Saisissez une adresse e-mail valide.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Adresse e-mail'), 'new@example.com');
    await user.type(screen.getByLabelText('Nom'), 'Nina Support');
    await user.type(screen.getByLabelText('Mot de passe initial'), 'Another-Secret-123');
    await user.click(screen.getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      email: 'new@example.com',
      name: 'Nina Support',
      role: 'SUPPORT',
    });
  });
});

describe('impersonation and audit helpers', () => {
  it('builds the tenant hand-off URL with the token in the fragment only', () => {
    const url = handoffUrl(
      {
        accessToken: 'secret-token',
        sessionId: 's1',
        expiresAt: '2030-01-01T00:30:00Z',
        tenant: { id: 't', slug: 'h', name: 'H', host: 'hotel.example.com' },
        user: { id: 'u', name: 'U', email: 'u@example.com' },
      },
      'Ticket 4521: erreur de facturation',
      { id: 'pu-1', name: 'Root' },
    );
    expect(url).toMatch(/^https?:\/\/hotel\.example\.com\/#impersonate=/);
    expect(url?.split('#')[0]).not.toContain('secret-token');
    expect(
      handoffUrl(
        {
          accessToken: 'x',
          sessionId: 's',
          expiresAt: '',
          tenant: { id: 't', slug: 'h', name: 'H', host: null },
          user: { id: 'u', name: 'U', email: '' },
        },
        'r'.repeat(10),
        { id: '', name: '' },
      ),
    ).toBeNull();
  });

  it('requires a reason of at least 10 characters to start an impersonation', async () => {
    const user = userEvent.setup();
    signInAs('SUPPORT');
    const calls = stubApi({ 'GET /impersonations': () => json(200, { items: [] }) });
    renderApp('/impersonations');
    await user.click(await screen.findByRole('button', { name: 'Démarrer une session' }));
    await user.type(await screen.findByLabelText("Identifiant de l'établissement"), 'pas-un-uuid');
    await user.type(screen.getByLabelText('Motif'), 'court');
    await user.click(screen.getByRole('button', { name: 'Démarrer' }));
    expect(
      await screen.findByText('Le motif doit contenir au moins 10 caractères.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('only sends valid filters to the audit API', () => {
    const q = platformAuditQuery({
      action: ' platform_user.* ',
      entity: '',
      userId: 'not-a-uuid',
      range: ['2026-01-01', '2026-02-01'],
    });
    expect(new URLSearchParams(q).toString()).toBe(q);
    expect(Object.fromEntries(new URLSearchParams(q))).toEqual({
      action: 'platform_user.*',
      from: '2026-01-01',
      to: '2026-02-01',
    });
  });
});
