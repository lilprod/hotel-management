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

describe('admin shell', () => {
  it('registers every Super Admin module', () => {
    expect(modules.map((m) => m.key)).toEqual([
      'dashboard',
      'tenants',
      'plans',
      'invoices',
      'payments',
      'payment-declarations',
      'reports',
      'announcements',
      'support',
      'platform-users',
      'settings',
    ]);
  });

  it('renders the layout with the full sidebar', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('menuitem')).toHaveLength(modules.length);
    expect(screen.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeInTheDocument();
  });

  it('filters sidebar items by permissions', () => {
    useSessionStore.setState({ features: ['*'], permissions: ['platform.tenants.read'] });
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByText('Établissements')).toBeInTheDocument();
    expect(within(nav).queryByText('Factures')).not.toBeInTheDocument();
  });

  it('switches language from the header', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('EN'));
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByText('Tenants')).toBeInTheDocument();
  });

  it('validates the login form without calling an API', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Saisissez une adresse e-mail valide.')).toBeInTheDocument();
  });
});
