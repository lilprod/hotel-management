import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useUiStore } from '@hm/ui';

import i18n from './i18n';
import { modules } from './modules';
import { renderApp, signInAs, signOut } from './test-utils';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  signInAs('SUPER_ADMIN');
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
      'impersonations',
      'audit',
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
    signInAs('FINANCE');
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByText('Établissements')).toBeInTheDocument();
    expect(within(nav).getByText('Factures')).toBeInTheDocument();
    expect(within(nav).queryByText('Utilisateurs plateforme')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Impersonation')).not.toBeInTheDocument();
  });

  it('switches language from the header', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('EN'));
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByText('Tenants')).toBeInTheDocument();
  });

  it('validates the login form without calling an API', async () => {
    signOut();
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Saisissez une adresse e-mail valide.')).toBeInTheDocument();
  });
});

describe('admin brand block', () => {
  it('splits the product name and the Super Admin badge instead of one truncated title', () => {
    renderApp();
    const block = screen.getByTestId('brand-block');
    expect(within(block).getByText('Hotel Management')).toBeInTheDocument();
    expect(within(block).getByText('Super Admin')).toBeInTheDocument();
    expect(block).not.toHaveTextContent('Hotel Management - Super Admin');
  });
});
