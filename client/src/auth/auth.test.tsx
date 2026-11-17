import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider, useUiStore } from '@hm/ui';

import i18n from '../i18n';
import { PermissionMatrix } from '../pages/security/PermissionMatrix';
import { ME, json, renderApp, signIn, signOut, stubApi } from '../test-utils';
import { useMeStore } from './session';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => vi.unstubAllGlobals());

const TOKENS = { accessToken: 'at-1', tokenType: 'Bearer', expiresIn: 900, csrfToken: 'c1' };

describe('login', () => {
  it('goes password → MFA step → session', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      'POST /auth/login': () =>
        json(200, { mfaRequired: true, challengeToken: 'challenge-token-123' }),
      'POST /auth/mfa/verify': () => json(200, TOKENS),
      'GET /auth/me': () => json(200, ME),
    });
    renderApp('/dashboard');
    // unauthenticated: redirected to the login page
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'demo@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'Secret-123!');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(
      await screen.findByRole('heading', { name: 'Vérification en deux étapes' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code de vérification'), '123456');
    await user.click(await screen.findByRole('button', { name: /Vérifier/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tableau de bord' }),
    ).toBeInTheDocument();
    const verify = calls.find((c) => c.url.endsWith('/mfa/verify'));
    expect(verify?.body).toEqual({ challengeToken: 'challenge-token-123', code: '123456' });
    const me = calls.find((c) => c.url.endsWith('/auth/me'));
    expect(me).toBeDefined();
    // tokens stay in memory: nothing of the session in storage
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('at-1');
  });

  it('shows the translated error of a refused login', async () => {
    const user = userEvent.setup();
    stubApi({
      'POST /auth/login': () =>
        json(401, { code: 'UNAUTHENTICATED', title: 'Invalid credentials' }),
    });
    renderApp('/login');
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'demo@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(
      await screen.findByText('Identifiants invalides ou session expirée.'),
    ).toBeInTheDocument();
  });

  it('enrols TOTP when the tenant requires it: QR code then backup codes', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      'POST /auth/login': () =>
        json(200, { mfaSetupRequired: true, challengeToken: 'setup-challenge-123' }),
      'POST /auth/mfa/setup': () =>
        json(200, {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/Hotel:demo@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Hotel',
          expiresInSeconds: 600,
        }),
      'POST /auth/mfa/activate': () =>
        json(200, { ...TOKENS, backupCodes: ['AAAA-1111', 'BBBB-2222'] }),
      'GET /auth/me': () => json(200, ME),
    });
    renderApp('/login');
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'demo@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'Secret-123!');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    const qr = await screen.findByRole('img', { name: /QR code/ });
    await waitFor(() => expect(qr.querySelector('svg')).not.toBeNull());
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
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
});

describe('route guards', () => {
  it('redirects an unauthenticated visitor to /login', async () => {
    renderApp('/guests');
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('redirects to /change-password while a password change is pending', async () => {
    signIn({ mustChangePassword: true });
    renderApp('/dashboard');
    expect(
      await screen.findByRole('heading', { name: 'Changer le mot de passe' }),
    ).toBeInTheDocument();
  });

  it('redirects to /legal while the latest terms are pending, and lets the owner accept', async () => {
    const user = userEvent.setup();
    signIn({ legalBlocked: true });
    useMeStore.setState({
      me: {
        ...ME,
        legal: {
          blocked: true,
          canAccept: true,
          pending: [{ id: 'd1', type: 'TOS', version: '2' }],
        },
      },
    });
    const calls = stubApi({
      'GET /legal/documents': () =>
        json(200, {
          items: [
            {
              id: 'd1',
              type: 'TOS',
              version: '2',
              locale: 'fr',
              publishedAt: '2026-01-01',
              content: 'CGU texte',
              accepted: false,
            },
          ],
        }),
      'POST /legal/accept': () => json(200, { blocked: false, canAccept: true, pending: [] }),
      'GET /auth/me': () => json(200, ME),
    });
    renderApp('/reservations');
    expect(
      await screen.findByRole('heading', { name: 'Conditions générales' }),
    ).toBeInTheDocument();
    const accept = await screen.findByRole('button', { name: 'Accepter' });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(accept);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/legal/accept'))?.body).toEqual({
        documentIds: ['d1'],
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tableau de bord' }),
    ).toBeInTheDocument();
  });

  it('shows a forbidden page when the permission is missing', async () => {
    signIn({ permissions: ['guests.read'], features: ['*'] });
    renderApp('/settings/security');
    expect(await screen.findByText('Module indisponible')).toBeInTheDocument();
  });

  it('filters the sidebar with real permissions (wildcards included)', async () => {
    signIn({ permissions: ['guests.*', 'settings.read'], features: ['spa'] });
    renderApp('/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByText('Clients')).toBeInTheDocument();
    expect(within(nav).getByText('Paramètres')).toBeInTheDocument();
    expect(within(nav).queryByText('Réservations')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Sécurité')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Spa')).not.toBeInTheDocument(); // feature ok, permission missing
  });

  it('shows the impersonation banner (who, reason, time left, exit)', async () => {
    signIn({
      impersonation: {
        by: 'pu1',
        byName: 'Awa Support',
        reason: 'Ticket 4521 : erreur de tarif',
        expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(),
      },
    });
    renderApp('/dashboard');
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Awa Support');
    expect(banner).toHaveTextContent('Ticket 4521');
    expect(banner).toHaveTextContent(/Temps restant : 2[45]:\d\d/);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Quitter la session de support' }));
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });
});

describe('PermissionMatrix', () => {
  const catalog = {
    modules: [
      { module: 'guests', permissions: ['guests.read', 'guests.create'] },
      { module: 'folio', permissions: ['folio.read', 'folio.discount'] },
    ],
  };

  function Harness({
    readOnly = false,
    onChange,
  }: {
    readOnly?: boolean;
    onChange: (s: Set<string>) => void;
  }) {
    return (
      <HmThemeProvider>
        <PermissionMatrix
          catalog={catalog}
          value={new Set(['guests.read'])}
          readOnly={readOnly}
          onChange={onChange}
          sensitive={['folio.discount']}
        />
      </HmThemeProvider>
    );
  }

  it('toggles a permission and a whole module', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'create' }));
    expect([...onChange.mock.calls[0]![0]].sort()).toEqual(['guests.create', 'guests.read']);
    await user.click(
      screen.getByRole('checkbox', { name: /Toutes les permissions du module Folio/ }),
    );
    expect([...onChange.mock.calls[1]![0]].sort()).toEqual([
      'folio.discount',
      'folio.read',
      'guests.read',
    ]);
    expect(screen.getByText('sensible')).toBeInTheDocument();
  });

  it('is read-only for system roles', () => {
    render(<Harness readOnly onChange={vi.fn()} />);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });
});
