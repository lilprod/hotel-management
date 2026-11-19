import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '@hm/ui';

import { apiClient } from './auth/session';
import type { Banner, BannersResponse } from './billing/common';
import { useSuspendedStore } from './billing/suspended';
import { BillingBanners } from './components/BillingBanners';
import i18n from './i18n';
import { json, renderApp, signIn, signOut, stubApi } from './test-utils';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
  useSuspendedStore.setState({ open: false });
});
afterEach(() => vi.unstubAllGlobals());

const QUOTAS = [
  { key: 'properties', used: 1, limit: 1 },
  { key: 'units', used: 12, limit: 20 },
  { key: 'users', used: 3, limit: null },
  { key: 'storage_mb', used: 40, limit: 1000 },
  { key: 'sms_per_month', used: 0, limit: 0 },
];

const overview = (over: Record<string, unknown> = {}) => ({
  today: '2026-11-18',
  subscription: {
    status: 'ACTIVE',
    plan: { id: 'plan-std', code: 'STD', name: 'Standard' },
    billingCycle: 'MONTHLY',
    trialEndsAt: null,
    currentPeriodStart: '2026-11-01',
    currentPeriodEnd: '2026-12-01',
    graceEndsAt: null,
    cancelAt: null,
    pendingChange: null,
    ...over,
  },
  features: ['lodging.core'],
  quotas: QUOTAS,
  amountDue: 25000,
  currency: 'XOF',
  credit: 0,
});

const PLANS = [
  {
    id: 'plan-start',
    code: 'START',
    name: 'Start',
    description: null,
    trialDays: 14,
    features: ['lodging.core'],
    quotas: { properties: 1, units: 10, users: 3, storage_mb: 500, sms_per_month: 0 },
    prices: { MONTHLY: 10000, QUARTERLY: 28000, YEARLY: 100000 },
    currency: 'XOF',
  },
  {
    id: 'plan-std',
    code: 'STD',
    name: 'Standard',
    description: null,
    trialDays: 14,
    features: ['lodging.core', 'restaurant'],
    quotas: { properties: 1, units: 20, users: null, storage_mb: 1000, sms_per_month: 0 },
    prices: { MONTHLY: 25000, QUARTERLY: 70000, YEARLY: 250000 },
    currency: 'XOF',
  },
  {
    id: 'plan-pro',
    code: 'PRO',
    name: 'Pro',
    description: null,
    trialDays: 0,
    features: ['lodging.core', 'restaurant', 'spa'],
    quotas: { properties: 5, units: 100, users: null, storage_mb: 5000, sms_per_month: 500 },
    prices: { MONTHLY: 60000, QUARTERLY: null, YEARLY: 600000 },
    currency: 'XOF',
  },
];

const INSTRUCTIONS = {
  payee: 'Plateforme SAS',
  note: '',
  methods: [
    { code: 'MIXX', label: 'Mixx by Yas', merchantNumber: '90 11 22 33' },
    { code: 'MOOV_MONEY', label: 'Moov Money', merchantNumber: '99 44 55 66' },
  ],
  amountDue: 25000,
  currency: 'XOF',
  invoices: [{ id: 'inv-1', number: 'PLT-2026-000007', dueDate: '2026-11-25', balance: 25000 }],
};

const api = (extra: Record<string, (b: unknown) => Response> = {}) => ({
  'GET /billing/subscription': () => json(200, overview()),
  'GET /billing/plans': () => json(200, { items: PLANS }),
  'GET /billing/invoices': () =>
    json(200, {
      total: 1,
      items: [
        {
          id: 'inv-1',
          number: 'PLT-2026-000007',
          issueDate: '2026-11-01',
          dueDate: '2026-11-25',
          currency: 'XOF',
          total: 25000,
          amountPaid: 0,
          balance: 25000,
          status: 'ISSUED',
          overdue: false,
        },
      ],
    }),
  'GET /billing/receipts': () => json(200, { items: [] }),
  'GET /billing/payment-instructions': () => json(200, INSTRUCTIONS),
  'GET /billing/declarations': () => json(200, { items: [] }),
  'GET /billing/banners': () =>
    json(200, {
      today: '2026-11-18',
      currency: 'XOF',
      status: 'ACTIVE',
      readOnly: false,
      items: [],
    }),
  ...extra,
});

describe('Abonnement page', () => {
  it('shows the plan, the status, the quota bars and the plan comparison', async () => {
    signIn();
    stubApi(api());
    renderApp('/settings/subscription');
    expect(
      await screen.findByText('Offre actuelle', { selector: '.ant-card-head-title' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Actif')).toBeInTheDocument();
    expect(screen.getByText(/dans 13 jours/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Chambres / unités' })).toHaveAttribute(
      'aria-valuenow',
      '60',
    );
    expect(screen.getByText('3 / Illimité')).toBeInTheDocument();
    // comparison: prices of the 3 plans + features
    expect(
      await screen.findByText('Pro', { selector: '.ant-table-cell div div' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/60\s000/)).toBeInTheDocument();
    expect(screen.getAllByText('Spa').length).toBeGreaterThan(0);
    // payment instructions with copy buttons
    expect(await screen.findByText('90 11 22 33')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copier .*Mixx by Yas/ })).toBeInTheDocument();
    expect(screen.getAllByText('PLT-2026-000007').length).toBeGreaterThan(1);
    // invoice "Ouverte" with its PDF button
    expect(await screen.findByText('Ouverte')).toBeInTheDocument();
  });

  it('requests an upgrade: immediate effect with a prorata notice', async () => {
    const user = userEvent.setup();
    signIn();
    const calls = stubApi(
      api({
        'POST /billing/plan-change': () =>
          json(200, {
            mode: 'immediate',
            effectiveAt: '2026-11-18',
            invoiceIds: ['i2'],
            pendingChange: null,
          }),
      }),
    );
    renderApp('/settings/subscription');
    await user.click(await screen.findByRole('button', { name: 'Demander ce plan — Pro' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/au prorata/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le changement' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/billing/plan-change'))?.body).toEqual({
        planId: 'plan-pro',
        billingCycle: 'MONTHLY',
      }),
    );
    expect(await screen.findByText(/Offre mise à jour/)).toBeInTheDocument();
  });

  it('requests a downgrade: effective at the period end', async () => {
    const user = userEvent.setup();
    signIn();
    const calls = stubApi(
      api({
        'POST /billing/plan-change': () =>
          json(200, {
            mode: 'scheduled',
            effectiveAt: '2026-12-01',
            invoiceIds: [],
            pendingChange: {},
          }),
      }),
    );
    renderApp('/settings/subscription');
    await user.click(await screen.findByRole('button', { name: 'Demander ce plan — Start' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/fin de la période en cours \(1 déc\. 2026\)/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/au prorata/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le changement' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/billing/plan-change'))?.body).toEqual({
        planId: 'plan-start',
        billingCycle: 'MONTHLY',
      }),
    );
    expect(await screen.findByText(/Changement programmé pour la fin/)).toBeInTheDocument();
  });

  it('shows the server refusal (quota exceeded on a downgrade) in the dialog', async () => {
    const user = userEvent.setup();
    signIn();
    stubApi(
      api({
        'POST /billing/plan-change': () =>
          json(412, { title: 'Precondition failed', code: 'PRECONDITION_FAILED', status: 412 }),
      }),
    );
    renderApp('/settings/subscription');
    await user.click(await screen.findByRole('button', { name: 'Demander ce plan — Start' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le changement' }));
    expect((await within(dialog).findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('shows the rejection reason in the declarations history', async () => {
    signIn();
    stubApi(
      api({
        'GET /billing/declarations': () =>
          json(200, {
            items: [
              {
                id: 'd1',
                amount: 25000,
                currency: 'XOF',
                method: 'MOOV_MONEY',
                reference: 'MV123',
                paidAt: '2026-11-10',
                note: null,
                status: 'REJECTED',
                rejectReason: 'Référence introuvable',
                createdAt: '2026-11-11T08:00:00Z',
              },
            ],
          }),
      }),
    );
    renderApp('/settings/subscription');
    expect(await screen.findByText('Rejetée')).toBeInTheDocument();
    expect(screen.getByText(/Référence introuvable/)).toBeInTheDocument();
  });
});

describe('payment declaration form', () => {
  const open = async () => {
    signIn();
    const calls = stubApi(
      api({ 'POST /billing/declarations': () => json(201, { id: 'd9', status: 'SUBMITTED' }) }),
    );
    renderApp('/settings/subscription');
    await screen.findByRole('button', { name: 'Envoyer la déclaration' });
    return calls;
  };

  it('requires an amount, refuses a future date and a heavy file, then submits', async () => {
    const user = userEvent.setup();
    const calls = await open();
    // amount is pre-filled with the amount due: clear it
    const amount = screen.getByLabelText(/Montant payé/);
    expect(amount).toHaveValue('25000');
    await user.clear(amount);
    fireEvent.change(screen.getByLabelText(/Date du paiement/), {
      target: { value: '2999-01-01' },
    });
    await user.click(screen.getByRole('button', { name: 'Envoyer la déclaration' }));
    expect(
      await screen.findByText('Saisissez un montant entier supérieur à 0.'),
    ).toBeInTheDocument();
    expect(screen.getByText('La date ne peut pas être dans le futur.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/billing/declarations') && c.method === 'POST')).toBe(
      false,
    );

    // file too large
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    });
    await user.upload(document.querySelector('input[type="file"]')!, big);
    expect(await screen.findByText('Le fichier dépasse 5 Mo.')).toBeInTheDocument();

    // valid form
    expect(amount).toHaveValue('');
    fireEvent.change(amount, { target: { value: '25000' } });
    fireEvent.change(screen.getByLabelText(/Date du paiement/), {
      target: { value: '2026-01-05' },
    });
    await user.type(screen.getByLabelText(/Référence de la transaction/), 'MV-998877');
    await user.click(screen.getByRole('button', { name: 'Envoyer la déclaration' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.url.endsWith('/billing/declarations') && c.method === 'POST')?.body,
      ).toEqual({
        method: 'MIXX',
        amount: 25000,
        currency: 'XOF',
        paidAt: '2026-01-05',
        reference: 'MV-998877',
      }),
    );
    expect(await screen.findByText(/Déclaration envoyée/)).toBeInTheDocument();
  });
});

describe('billing banners', () => {
  const show = async (items: Banner[], status = 'ACTIVE', permissions: string[] = ['*']) => {
    signIn({ permissions });
    const calls = stubApi({
      'GET /billing/banners': () =>
        json(200, {
          today: '2026-11-18',
          currency: 'XOF',
          status,
          readOnly: status === 'SUSPENDED',
          items,
        } satisfies BannersResponse),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <BillingBanners />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return calls;
  };

  it('trial J-x is informative', async () => {
    await show(
      [{ kind: 'trial', severity: 'info', daysLeft: 12, endsAt: '2026-11-30' }],
      'TRIALING',
    );
    const banner = await screen.findByText(/Période d'essai : J-12/);
    expect(banner.closest('.ant-alert')).toHaveClass('ant-alert-info');
    expect(screen.getByRole('button', { name: "Voir l'abonnement" })).toBeInTheDocument();
  });

  it('due soon is a warning', async () => {
    await show([
      {
        kind: 'due_soon',
        severity: 'warning',
        invoiceNumber: 'PLT-2026-000007',
        dueDate: '2026-11-22',
        daysLeft: 4,
        amount: 25000,
      },
    ]);
    const banner = await screen.findByText(/PLT-2026-000007 de .*25\s000.* arrive à échéance/);
    expect(banner.closest('.ant-alert')).toHaveClass('ant-alert-warning');
  });

  it('overdue is an error with the planned suspension date', async () => {
    await show(
      [
        {
          kind: 'overdue',
          severity: 'error',
          amount: 25000,
          dueDate: '2026-11-05',
          suspensionDate: '2026-11-12',
        },
      ],
      'PAST_DUE',
    );
    const banner = await screen.findByText(/Paiement en retard/);
    expect(banner.closest('.ant-alert')).toHaveClass('ant-alert-error');
    expect(banner).toHaveTextContent(/Suspension prévue le 12 nov\. 2026/);
    expect(screen.getByRole('button', { name: 'Régler maintenant' })).toBeInTheDocument();
  });

  it('suspended is an error without close button and with the "Régler maintenant" CTA', async () => {
    await show(
      [{ kind: 'suspended', severity: 'error', amountDue: 25000, since: '2026-11-12' }],
      'SUSPENDED',
    );
    const banner = await screen.findByText(/Abonnement suspendu .* lecture seule/);
    const alert = banner.closest('.ant-alert')!;
    expect(alert).toHaveClass('ant-alert-error');
    expect(alert.querySelector('.ant-alert-close-icon')).toBeNull();
    expect(screen.getByRole('button', { name: 'Régler maintenant' })).toBeInTheDocument();
  });

  it('shows nothing and does not call the API without billing.manage', async () => {
    const calls = await show(
      [{ kind: 'suspended', severity: 'error', amountDue: 1, since: null }],
      'SUSPENDED',
      ['reservations.read'],
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/Abonnement suspendu/)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('read-only mode (suspended subscription)', () => {
  it('a refused write opens a modal pointing to the Abonnement page', async () => {
    const user = userEvent.setup();
    signIn();
    stubApi({
      ...api(),
      'POST /reservations': () =>
        json(402, { title: 'Subscription suspended', code: 'SUBSCRIPTION_SUSPENDED', status: 402 }),
    });
    renderApp('/dashboard');
    await act(async () => {
      await apiClient.post('/reservations', {}).catch(() => undefined);
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Lecture seule : abonnement suspendu')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: "Aller à l'abonnement" }));
    expect(
      await screen.findByText('Offre actuelle', { selector: '.ant-card-head-title' }),
    ).toBeInTheDocument();
  });

  it('a refused read does not open the modal', async () => {
    signIn();
    stubApi({
      ...api(),
      'GET /reservations': () =>
        json(402, { title: 'Subscription suspended', code: 'SUBSCRIPTION_SUSPENDED', status: 402 }),
    });
    renderApp('/dashboard');
    await act(async () => {
      await apiClient.get('/reservations').catch(() => undefined);
    });
    expect(useSuspendedStore.getState().open).toBe(false);
  });

  it('without billing.manage the modal asks to contact the owner', async () => {
    signIn({ permissions: ['reservations.read'] });
    stubApi({
      'POST /reservations': () =>
        json(402, { title: 'Subscription suspended', code: 'SUBSCRIPTION_SUSPENDED', status: 402 }),
    });
    renderApp('/dashboard');
    await act(async () => {
      await apiClient.post('/reservations', {}).catch(() => undefined);
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Contactez le propriétaire/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: "Aller à l'abonnement" })).toBeNull();
  });
});
