import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '@hm/ui';

import i18n from './i18n';
import { cleanSettings, validateSettings } from './pages/settings/BillingSettingsPage';
import type { BillingSettings } from './pages/settings/BillingSettingsPage';
import { json, renderApp, signInAs, signOut, stubApi } from './test-utils';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settings: BillingSettings = {
  identity: { legalName: 'Plateforme SA', country: 'TG', currency: 'XOF' },
  paymentInstructions: { note: '', methods: [{ code: 'MIXX', label: 'Mixx by Yas' }] },
  graceDays: 7,
  suspensionDays: 90,
  purgeDays: 90,
  paymentTermsDays: 7,
  renewalLeadDays: 7,
  doubleValidation: false,
  smsReminders: false,
  vat: { enabled: false, rateBps: 1800, label: 'TVA' },
  reminders: [{ model: 'invoice_due', offsetsDays: [0], channels: ['EMAIL'] }],
};

describe('billing settings', () => {
  it('validates and cleans the payload (no empty optional strings)', () => {
    expect(
      validateSettings({ ...settings, identity: { ...settings.identity, legalName: ' ' } }),
    ).toContain('legalName');
    expect(validateSettings({ ...settings, vat: { ...settings.vat, rateBps: 12_000 } })).toContain(
      'vat',
    );
    const cleaned = cleanSettings({
      ...settings,
      identity: { ...settings.identity, email: '  ', taxId: ' 123 ' },
    });
    expect(cleaned.identity).toEqual({
      legalName: 'Plateforme SA',
      country: 'TG',
      currency: 'XOF',
      taxId: '123',
    });
  });

  it('lets SUPER_ADMIN edit and save the settings', async () => {
    const user = userEvent.setup();
    signInAs('SUPER_ADMIN');
    const calls = stubApi({
      'GET /billing/settings': () => json(200, settings),
      'PATCH /billing/settings': (b) => json(200, b),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Délais et validation' }));
    const grace = await screen.findByLabelText(/Période de grâce/);
    await user.clear(grace);
    await user.type(grace, '10');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toMatchObject({ graceDays: 10, vat: { rateBps: 1800 } });
    });
  });
});

describe('reports', () => {
  it('shows the aged receivables with totals and exports the CSV', async () => {
    const user = userEvent.setup();
    signInAs('FINANCE');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const calls = stubApi({
      'GET /billing/reports/aged-receivables': () =>
        json(200, {
          asOf: '2026-03-31',
          rows: [
            {
              tenant: { id: 't1', name: 'Hôtel Lac', slug: 'lac' },
              currency: 'XOF',
              current: 0,
              d1_30: 50_000,
              d31_60: 0,
              d61_90: 0,
              d90_plus: 20_000,
              total: 70_000,
            },
          ],
          totals: {
            current: 0,
            d1_30: 50_000,
            d31_60: 0,
            d61_90: 0,
            d90_plus: 20_000,
            total: 70_000,
          },
        }),
      'GET /billing/reports/aged-receivables.csv': () => json(200, {}),
    });
    renderApp('/reports');
    expect(await screen.findByRole('link', { name: 'Hôtel Lac' })).toBeInTheDocument();
    expect(screen.getAllByText(/70\s000/).length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/aged-receivables.csv?asOf='))).toBe(true),
    );
  });
});

describe('plans', () => {
  const plans = {
    items: [
      {
        id: 'p1',
        code: 'PRO',
        name: 'Pro',
        description: null,
        trialDays: 14,
        sort: 1,
        isPublic: true,
        isActive: true,
        deletedAt: null,
        features: ['lodging.core'],
        quotas: { units: 20, users: null },
        prices: [
          {
            id: 'pr1',
            billingCycle: 'MONTHLY',
            currency: 'XOF',
            amount: 25_000,
            validFrom: '2026-01-01',
            validTo: null,
          },
        ],
        priceHistory: [
          {
            id: 'pr0',
            billingCycle: 'MONTHLY',
            currency: 'XOF',
            amount: 20_000,
            validFrom: '2025-01-01',
            validTo: '2026-01-01',
          },
          {
            id: 'pr1',
            billingCycle: 'MONTHLY',
            currency: 'XOF',
            amount: 25_000,
            validFrom: '2026-01-01',
            validTo: null,
          },
        ],
        subscribers: 3,
      },
    ],
  };

  it('hides plan creation from READ_ONLY and shows it to SUPER_ADMIN', async () => {
    stubApi({ 'GET /plans': () => json(200, plans) });
    signInAs('READ_ONLY');
    renderApp('/plans');
    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nouvelle offre/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Consulter' })).toBeInTheDocument();
  });

  it('shows the price version history of a plan to SUPER_ADMIN', async () => {
    const user = userEvent.setup();
    signInAs('SUPER_ADMIN');
    stubApi({
      'GET /plans': () => json(200, plans),
      'GET /plans/p1': () => json(200, plans.items[0]),
    });
    renderApp('/plans');
    expect(await screen.findByRole('button', { name: /Nouvelle offre/ })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    await user.click(await screen.findByRole('tab', { name: 'Tarifs' }));
    expect(await screen.findByText('Historique des tarifs')).toBeInTheDocument();
    expect(screen.getAllByText(/20\s000/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Ajouter ce tarif' })).toBeDisabled();
  });
});
