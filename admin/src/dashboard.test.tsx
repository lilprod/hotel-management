import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '@hm/ui';

import i18n from './i18n';
import { stackCollections } from './pages/dashboard/DashboardPage';
import { json, renderApp, signInAs, signOut, stubApi } from './test-utils';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => vi.unstubAllGlobals());

describe('dashboard', () => {
  it('stacks the 12-month collections by method for the platform currency', () => {
    const rows = [
      { period: '2026-02', method: 'MIXX', currency: 'XOF', amount: 100, count: 1 },
      { period: '2026-01', method: 'CASH', currency: 'XOF', amount: 50, count: 1 },
      { period: '2026-02', method: 'MIXX', currency: 'XOF', amount: 20, count: 1 },
      { period: '2026-02', method: 'CARD', currency: 'EUR', amount: 9, count: 1 },
    ] as const;
    expect(stackCollections([...rows])).toEqual([
      { period: '2026-01', CASH: 50 },
      { period: '2026-02', MIXX: 120 },
    ]);
  });

  it('shows the KPIs, the status counts and the overdue / upcoming lists', async () => {
    signInAs('FINANCE');
    const invoice = (id: string, number: string, dueDate: string, overdue: boolean) => ({
      id,
      number,
      tenant: { id: 't1', name: 'Hôtel Lac', slug: 'lac' },
      issueDate: '2026-01-01',
      dueDate,
      currency: 'XOF',
      total: 50_000,
      amountPaid: 0,
      balance: 50_000,
      status: 'ISSUED',
      overdue,
    });
    stubApi({
      'GET /billing/reports/dashboard': () =>
        json(200, {
          asOf: '2026-03-15',
          revenue: {
            subscriptions: 4,
            byCurrency: [{ currency: 'XOF', mrr: 1_250_000, arr: 15_000_000 }],
          },
          tenantsByStatus: { TRIALING: 2, ACTIVE: 4, PAST_DUE: 1, SUSPENDED: 0, CANCELLED: 3 },
          trialConversions: { started: 5, converted: 3, lost: 1, conversionRateBps: 7500 },
          collectionsThisMonth: [{ method: 'MOOV_MONEY', currency: 'XOF', amount: 300_000 }],
          receivables: { total: 100_000, d1_30: 50_000, d31_60: 0, d61_90: 0, d90_plus: 0 },
        }),
      'GET /billing/reports/collections': () => json(200, { rows: [], totalsByMethod: [] }),
      'GET /invoices': () =>
        json(200, { items: [invoice('i1', 'PLT-2026-000009', '2999-01-01', false)], total: 1 }),
    });
    renderApp('/dashboard');
    expect(await screen.findByText(/1\s250\s000/)).toBeInTheDocument();
    expect(screen.getByText(/15\s000\s000/)).toBeInTheDocument();
    expect(screen.getByText(/75/)).toBeInTheDocument();
    expect(screen.getByText(/300\s000/)).toBeInTheDocument();
    expect(
      (await screen.findAllByRole('link', { name: 'PLT-2026-000009' })).length,
    ).toBeGreaterThan(0);
  });
});
