import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '@hm/ui';

import { autoAllocate, splitPayment } from './billing/allocation';
import type { Invoice, Payment } from './billing/common';
import i18n from './i18n';
import { json, meOf, renderApp, signInAs, signOut, stubApi } from './test-utils';

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
  signOut();
});
afterEach(() => vi.unstubAllGlobals());

const tenant = { id: 'ten-1', name: 'Hôtel Lac', slug: 'hotel-lac' };

const invoice = (id: string, number: string, dueDate: string, balance: number): Invoice => ({
  id,
  number,
  tenant,
  issueDate: dueDate,
  dueDate,
  periodStart: null,
  periodEnd: null,
  currency: 'XOF',
  subtotal: balance,
  tax: 0,
  total: balance,
  amountPaid: 0,
  balance,
  status: 'ISSUED',
  overdue: false,
  createdAt: `${dueDate}T00:00:00Z`,
});

// Deliberately not sorted: the form must allocate oldest-open-first.
const INVOICES = [
  invoice('inv-b', 'PLT-2026-000002', '2026-02-10', 70_000),
  invoice('inv-a', 'PLT-2026-000001', '2026-01-10', 50_000),
];

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'pay-1',
  tenant,
  amount: 50_000,
  currency: 'XOF',
  method: 'MIXX',
  reference: 'TX-1',
  paidAt: '2026-03-01',
  status: 'PENDING_VALIDATION',
  attachmentFileId: null,
  note: null,
  recordedBy: 'platform:someone-else',
  validatedBy: null,
  validatedAt: null,
  reversedBy: null,
  reversedAt: null,
  reversalReason: null,
  receiptNumber: null,
  declarationId: null,
  plannedAllocations: [],
  allocations: [],
  credit: 0,
  createdAt: '2026-03-01T10:00:00Z',
  ...over,
});

const formApi = () => ({
  'GET /tenants': () => json(200, { items: [tenant], total: 1 }),
  'GET /invoices': () => json(200, { items: INVOICES, total: 2 }),
});

async function pickTenant(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText(/^Établissement/));
  await user.click(await screen.findByText('Hôtel Lac (hotel-lac)'));
}

describe('allocation maths', () => {
  it('fills the oldest open invoice first and leaves the surplus as credit', () => {
    const alloc = autoAllocate(150_000, INVOICES);
    expect(alloc).toEqual({ 'inv-a': 50_000, 'inv-b': 70_000 });
    expect(splitPayment(150_000, alloc)).toMatchObject({ remainder: 30_000, credit: 30_000 });
    expect(autoAllocate(60_000, INVOICES)).toEqual({ 'inv-a': 50_000, 'inv-b': 10_000 });
    expect(splitPayment(10_000, { 'inv-a': 12_000 }).overAllocated).toBe(true);
  });
});

describe('payment form', () => {
  it('validates the required fields and the date (not in the future)', async () => {
    const user = userEvent.setup();
    signInAs('FINANCE');
    stubApi(formApi());
    renderApp('/payments/new');
    await user.click(await screen.findByRole('button', { name: /Enregistrer le paiement/ }));
    expect(await screen.findByText('Choisissez un établissement.')).toBeInTheDocument();
    expect(screen.getByText('Saisissez un montant entier supérieur à 0.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Date du paiement/), {
      target: { value: '2999-01-01' },
    });
    await user.click(screen.getByRole('button', { name: /Enregistrer le paiement/ }));
    expect(
      await screen.findByText('La date du paiement ne peut pas être dans le futur.'),
    ).toBeInTheDocument();
  });

  it('pre-fills the allocation oldest-first and shows the remainder as credit live', async () => {
    const user = userEvent.setup();
    signInAs('FINANCE');
    stubApi(formApi());
    renderApp('/payments/new');
    await pickTenant(user);
    await user.type(screen.getByLabelText(/Montant \(XOF\)/), '150000');
    const a = await screen.findByLabelText('À imputer PLT-2026-000001');
    expect(a).toHaveValue('50000');
    expect(screen.getByLabelText('À imputer PLT-2026-000002')).toHaveValue('70000');
    expect(screen.getByTestId('remainder')).toHaveTextContent(/30\s000/);
    expect(screen.getByText(/sera conservé en crédit/)).toHaveTextContent(/30\s000/);

    // editing a line by hand keeps the manual value and updates the remainder
    await user.clear(screen.getByLabelText('À imputer PLT-2026-000002'));
    await user.type(screen.getByLabelText('À imputer PLT-2026-000002'), '10000');
    await waitFor(() => expect(screen.getByTestId('remainder')).toHaveTextContent(/90\s000/));
  });

  it('submits with an Idempotency-Key and shows the duplicate-reference conflict with a link', async () => {
    const user = userEvent.setup();
    signInAs('FINANCE');
    const calls = stubApi({
      ...formApi(),
      'POST /payments': () =>
        json(409, {
          title: 'Conflict',
          code: 'CONFLICT',
          meta: { reason: 'DUPLICATE_REFERENCE', existingPaymentId: 'pay-9' },
        }),
    });
    renderApp('/payments/new');
    await pickTenant(user);
    await user.type(screen.getByLabelText(/Montant \(XOF\)/), '50000');
    await user.type(screen.getByLabelText(/Référence de la transaction/), 'MP-777');
    await user.click(screen.getByRole('button', { name: /Enregistrer le paiement/ }));
    expect(
      await screen.findByText('Un paiement avec ce mode et cette référence existe déjà.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir le paiement existant' })).toHaveAttribute(
      'href',
      '/payments/pay-9',
    );
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/payments'))!;
    expect(post.headers['Idempotency-Key']).toMatch(/^[\w.:-]{8,200}$/);
    expect(post.body).toMatchObject({
      tenantId: 'ten-1',
      amount: 50_000,
      method: 'MIXX',
      reference: 'MP-777',
      allocations: [{ invoiceId: 'inv-a', amount: 50_000 }],
    });
  });
});

describe('role-based actions', () => {
  it('hides "Enregistrer un paiement" for READ_ONLY and shows it for FINANCE', async () => {
    stubApi({ 'GET /payments': () => json(200, { items: [], total: 0 }) });
    signInAs('READ_ONLY');
    renderApp('/payments');
    expect(await screen.findByRole('heading', { level: 1, name: 'Paiements' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer un paiement' })).toBeNull();
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
  });

  it('shows the record button to FINANCE', async () => {
    stubApi({ 'GET /payments': () => json(200, { items: [], total: 0 }) });
    signInAs('FINANCE');
    renderApp('/payments');
    expect(
      await screen.findByRole('button', { name: /Enregistrer un paiement/ }),
    ).toBeInTheDocument();
  });

  it('hides validate / reverse from READ_ONLY on the payment detail', async () => {
    stubApi({ 'GET /payments/pay-1': () => json(200, payment()) });
    signInAs('READ_ONLY');
    renderApp('/payments/pay-1');
    expect(await screen.findByText('À valider')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider le paiement' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Contre-passer' })).toBeNull();
  });

  it('forbids validating a payment recorded by the same user', async () => {
    const me = meOf('FINANCE');
    stubApi({
      'GET /payments/pay-1': () => json(200, payment({ recordedBy: `platform:${me.id}` })),
    });
    signInAs('FINANCE');
    renderApp('/payments/pay-1');
    const btn = await screen.findByRole('button', { name: 'Valider le paiement' });
    expect(btn).toBeDisabled();
  });

  it('lets another FINANCE user validate, and reverse with a mandatory reason', async () => {
    const user = userEvent.setup();
    signInAs('FINANCE');
    const calls = stubApi({
      'GET /payments/pay-1': () => json(200, payment()),
      'POST /payments/pay-1/validate': () => json(200, payment({ status: 'CONFIRMED' })),
      'POST /payments/pay-1/reverse': () => json(200, { payment: payment({ status: 'REVERSED' }) }),
    });
    renderApp('/payments/pay-1');
    const validate = await screen.findByRole('button', { name: 'Valider le paiement' });
    expect(validate).toBeEnabled();
    await user.click(validate);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pay-1/validate'))).toBe(
        true,
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Contre-passer' }));
    await user.click(screen.getAllByRole('button', { name: 'Contre-passer' }).at(-1)!);
    expect(await screen.findByText(/motif est obligatoire/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Motif/), 'Erreur de saisie');
    await user.click(screen.getAllByRole('button', { name: 'Contre-passer' }).at(-1)!);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/pay-1/reverse'))?.body).toEqual({
        reason: 'Erreur de saisie',
      }),
    );
  });
});
