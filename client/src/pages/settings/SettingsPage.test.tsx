import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import i18n from '../../i18n';
import { parseOptions } from './custom-fields/CustomFieldsPage';
import { SettingsPage } from './SettingsPage';

const PROPERTY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Hôtel Test',
  country: 'TG',
  currency: 'XOF',
  city: 'Lomé',
  timezone: 'Africa/Lome',
};
const calls: { method: string; url: string; body?: unknown }[] = [];

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url,
        ...(init?.body ? { body: JSON.parse(init.body as string) } : {}),
      });
      const body = url.includes('/lodging/properties')
        ? { items: [PROPERTY] }
        : { items: [], nextCursor: null };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HmThemeProvider>
        <SettingsPage />
      </HmThemeProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  it('lists the properties and every settings tab', async () => {
    renderPage();
    expect(await screen.findByText('Hôtel Test')).toBeInTheDocument();
    for (const name of [
      'Chambres',
      'Tarifs',
      'Taxes',
      'Politiques',
      'Produits',
      'Listes',
      'Champs personnalisés',
    ])
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  });

  it('validates the property form with Zod before calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    await user.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findAllByText(/Too small|Invalid|expected/i)).not.toHaveLength(0);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the rooms tab with bulk creation', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('tab', { name: 'Chambres' }));
    expect(await screen.findByRole('button', { name: 'Création en masse' })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/lodging/room-types?propertyId='))).toBe(true),
    );
  });

  it('switches to English', async () => {
    await i18n.changeLanguage('en');
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Rooms' })).toBeInTheDocument();
  });
});

describe('custom field options parser', () => {
  it('parses value=Label lines', () => {
    expect(parseOptions('sea=Mer\ngarden')).toEqual([
      { value: 'sea', label: { fr: 'Mer' } },
      { value: 'garden', label: { fr: 'garden' } },
    ]);
  });
});
