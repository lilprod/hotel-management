import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSessionStore, useUiStore } from '@hm/ui';

import { App } from './App';
import i18n from './i18n';
import { modules } from './modules';

function renderApp(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  useSessionStore.setState({ features: ['*'], permissions: ['*'] });
  await i18n.changeLanguage('fr');
});

describe('client shell', () => {
  it('registers every module of the back-office', () => {
    expect(modules.map((m) => m.key)).toEqual([
      'dashboard',
      'reservations',
      'calendar',
      'front-desk',
      'guests',
      'billing',
      'restaurant',
      'spa',
      'activities',
      'inventory',
      'maintenance',
      'housekeeping',
      'staff',
      'messages',
      'reports',
      'settings',
      'security',
      'branding',
    ]);
  });

  it('renders the layout with the full sidebar', () => {
    renderApp();
    expect(screen.getByRole('link', { name: 'Aller au contenu' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByText('Tableau de bord')).toBeInTheDocument();
    expect(within(nav).getAllByRole('menuitem')).toHaveLength(modules.length);
    expect(screen.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('filters sidebar items by enabled features', () => {
    useSessionStore.setState({ features: ['spa'], permissions: ['*'] });
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByText('Spa')).toBeInTheDocument();
    expect(within(nav).queryByText('Facturation')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Restaurant')).not.toBeInTheDocument();
    // modules without a required feature stay visible
    expect(within(nav).getByText('Clients')).toBeInTheDocument();
  });

  it('filters sidebar items by permissions', () => {
    useSessionStore.setState({ features: ['*'], permissions: ['guests.read'] });
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByText('Clients')).toBeInTheDocument();
    expect(within(nav).queryByText('Spa')).not.toBeInTheDocument();
  });

  it('switches language from the header', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('EN'));
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByText('Dashboard')).toBeInTheDocument();
    expect(useUiStore.getState().language).toBe('en');
  });

  it('toggles dark mode', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Basculer le mode clair / sombre' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('validates the login form without calling an API', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Saisissez une adresse e-mail valide.')).toBeInTheDocument();
    expect(await screen.findByText('Le mot de passe est obligatoire.')).toBeInTheDocument();
  });
});
