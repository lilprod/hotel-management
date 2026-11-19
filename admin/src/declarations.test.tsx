import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '@hm/ui';

import type { Declaration } from './pages/declarations/DeclarationsPage';
import i18n from './i18n';
import { json, renderApp, signInAs, signOut, stubApi } from './test-utils';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => vi.unstubAllGlobals());

const declaration: Declaration = {
  id: 'dec-1',
  tenantId: 'ten-1',
  paymentId: null,
  amount: 75_000,
  currency: 'XOF',
  method: 'MOOV_MONEY',
  reference: 'MM-123',
  paidAt: '2026-03-02',
  attachmentFileId: 'file-1',
  note: 'Paiement du mois de mars',
  status: 'SUBMITTED',
  submittedBy: 'user-1',
  reviewedBy: null,
  reviewedAt: null,
  rejectReason: null,
  createdAt: '2026-03-03T08:00:00Z',
};

const api = () => ({
  'GET /declarations': () => json(200, { items: [declaration], total: 1 }),
  'GET /tenants/ten-1': () => json(200, { id: 'ten-1', name: 'Hôtel Lac', slug: 'hotel-lac' }),
  'GET /declarations/dec-1/attachment': () =>
    json(200, { url: 'https://files.example/proof.png', mime: 'image/png' }),
});

async function openReview(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByText('Hôtel Lac')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Examiner' }));
  return screen.findByRole('dialog');
}

describe('payment declarations queue', () => {
  it('approves a declaration (creates the payment)', async () => {
    const user = userEvent.setup();
    signInAs('FINANCE');
    const calls = stubApi({
      ...api(),
      'POST /declarations/dec-1/approve': () =>
        json(200, {
          declaration: { ...declaration, status: 'APPROVED' },
          payment: { id: 'pay-5' },
        }),
    });
    renderApp('/payment-declarations');
    await openReview(user);
    expect(await screen.findByAltText(/Capture du paiement/)).toHaveAttribute(
      'src',
      'https://files.example/proof.png',
    );
    await user.click(screen.getByRole('button', { name: 'Approuver' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/dec-1/approve'))).toBe(true),
    );
  });

  it('rejects a declaration only with a reason', async () => {
    const user = userEvent.setup();
    signInAs('SUPER_ADMIN');
    const calls = stubApi({
      ...api(),
      'POST /declarations/dec-1/reject': () => json(200, { ...declaration, status: 'REJECTED' }),
    });
    renderApp('/payment-declarations');
    await openReview(user);
    await user.click(screen.getByRole('button', { name: 'Rejeter' }));
    await user.click(screen.getAllByRole('button', { name: 'Rejeter' }).at(-1)!);
    expect(await screen.findByText(/motif est obligatoire/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/reject'))).toBe(false);
    await user.type(screen.getByLabelText(/Motif/), 'Référence introuvable');
    await user.click(screen.getAllByRole('button', { name: 'Rejeter' }).at(-1)!);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/dec-1/reject'))?.body).toEqual({
        reason: 'Référence introuvable',
      }),
    );
  });

  it('degrades gracefully when the proof preview is unavailable', async () => {
    const user = userEvent.setup();
    signInAs('FINANCE');
    stubApi({
      ...api(),
      'GET /declarations/dec-1/attachment': () =>
        json(404, { title: 'Not found', code: 'NOT_FOUND' }),
    });
    renderApp('/payment-declarations');
    await openReview(user);
    expect(await screen.findByText(/aperçu n'est pas disponible/)).toBeInTheDocument();
  });

  it('shows no approve / reject action to a role without review rights', async () => {
    const user = userEvent.setup();
    signInAs('SUPER_ADMIN');
    stubApi({
      ...api(),
      'GET /declarations': () =>
        json(200, {
          items: [{ ...declaration, status: 'APPROVED', paymentId: 'pay-5' }],
          total: 1,
        }),
    });
    renderApp('/payment-declarations');
    await openReview(user);
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rejeter' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Voir le paiement' })).toHaveAttribute(
      'href',
      '/payments/pay-5',
    );
  });
});
