import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '@hm/ui';

import type { TenantDetail } from './billing/models';
import i18n from './i18n';
import { json, renderApp, signInAs, signOut, stubApi } from './test-utils';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => vi.unstubAllGlobals());

const tenant: TenantDetail = {
  id: 'ten-1',
  slug: 'hotel-lac',
  name: 'Hôtel Lac',
  legalName: null,
  status: 'ACTIVE',
  country: 'TG',
  timezone: 'Africa/Lome',
  currency: 'XOF',
  locale: 'fr',
  email: 'contact@lac.tg',
  phone: null,
  notes: 'VIP',
  tags: ['vip'],
  allowImpersonation: false,
  domains: [],
  subscription: {
    id: 'sub-1',
    status: 'ACTIVE',
    plan: { id: 'plan-1', code: 'PRO', name: 'Pro' },
    billingCycle: 'MONTHLY',
    trialEndsAt: null,
    currentPeriodStart: '2026-03-01',
    currentPeriodEnd: '2026-04-01',
    graceEndsAt: null,
    cancelAt: null,
    pendingChange: null,
  },
  entitlements: { features: [], quotas: {}, planCode: 'PRO' },
  quotaUsage: [
    { key: 'units', used: 12, limit: 10 },
    { key: 'users', used: 3, limit: null },
  ],
  credit: 0,
  invoices: [],
  payments: [],
  declarations: [],
  events: [],
  addons: [],
  overrides: [],
  createdAt: '2026-01-01T00:00:00Z',
};

const api = () => ({
  'GET /tenants/ten-1': () => json(200, tenant),
  'GET /plans': () => json(200, { items: [] }),
  'GET /addons': () => json(200, { items: [] }),
});

describe('tenant detail', () => {
  it('shows quota bars and the subscription actions to SUPER_ADMIN, suspend asks for a reason', async () => {
    const user = userEvent.setup();
    signInAs('SUPER_ADMIN');
    const calls = stubApi({
      ...api(),
      'POST /tenants/ten-1/suspend': () => json(200, { status: 'SUSPENDED' }),
    });
    renderApp('/tenants/ten-1');
    expect(await screen.findByText('Chambres / unités')).toBeInTheDocument();
    expect(screen.getByText('12 / 10')).toBeInTheDocument();
    expect(screen.getByText('3 / illimité')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suspendre' }));
    await user.click(screen.getAllByRole('button', { name: 'Suspendre' }).at(-1)!);
    expect(await screen.findByText(/motif est obligatoire/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Motif/), 'Impayé de 60 jours');
    await user.click(screen.getAllByRole('button', { name: 'Suspendre' }).at(-1)!);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/ten-1/suspend'))?.body).toEqual({
        reason: 'Impayé de 60 jours',
      }),
    );
  });

  it('SUPPORT reads the tenant and can edit notes, but has no subscription action', async () => {
    signInAs('SUPPORT');
    stubApi(api());
    renderApp('/tenants/ten-1');
    expect(await screen.findByText('Chambres / unités')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspendre' })).toBeNull();
    expect(screen.queryByRole('button', { name: "Changer d'offre" })).toBeNull();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Notes et étiquettes' }));
    expect(await screen.findByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
  });

  it('READ_ONLY cannot edit notes nor create a tenant', async () => {
    signInAs('READ_ONLY');
    stubApi({ ...api(), 'GET /tenants': () => json(200, { items: [], total: 0 }) });
    renderApp('/tenants/ten-1');
    expect(await screen.findByText('Chambres / unités')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Notes et étiquettes' }));
    expect(await screen.findByLabelText('Notes internes')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });

  it('hides the create-tenant button from non SUPER_ADMIN roles', async () => {
    signInAs('FINANCE');
    stubApi({
      'GET /tenants': () => json(200, { items: [], total: 0 }),
      'GET /plans': () => json(200, { items: [] }),
    });
    renderApp('/tenants');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Établissements' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nouvel établissement/ })).toBeNull();
  });
});
