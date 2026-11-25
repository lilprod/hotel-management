import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import { useMeStore } from '../../auth/session';
import i18n from '../../i18n';
import { usePropertyStore } from '../../reservations/property';
import { ME, signIn, signOut } from '../../test-utils';
import type { CashSession, Folio, Invoice } from './api';
import { CloseSessionModal } from './CashPage';
import { InvoiceDialog } from './InvoiceDialogs';
import { convertTender, groupLines, taxLabel } from './model';
import { FolioPage } from './FolioPage';
import { PaymentForm } from './PaymentForm';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: (ev: string, cb: (p: unknown) => void) => handlers.set(ev, cb),
    off: (ev: string) => handlers.delete(ev),
    disconnect: () => undefined,
  })),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}
function stubApi(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const call: Call = {
        method,
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        ...(init?.body ? { body: JSON.parse(init.body as string) as Record<string, unknown> } : {}),
      };
      calls.push(call);
      const path = url.split('?')[0]!;
      const key = Object.keys(routes).find((k) => {
        const [m, suffix] = k.split(' ') as [string, string];
        return m === method && path.endsWith(suffix);
      });
      return Promise.resolve(
        key ? routes[key]!(call) : json(404, { title: 'nf', code: 'NOT_FOUND' }),
      );
    }),
  );
  return calls;
}

const folio = (over: Partial<Folio> = {}): Folio => ({
  id: 'f1',
  propertyId: 'p1',
  number: 'F-0001',
  status: 'OPEN',
  currency: 'XOF',
  balance: 118000,
  stayId: 's1',
  groupId: null,
  companyId: null,
  closedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'STAY',
  reservationId: null,
  reservationNumber: 'RES-1',
  reservationRoomId: null,
  chargesTotal: 118000,
  paymentsTotal: 0,
  taxBreakdown: {
    net: 100000,
    percentTax: 18000,
    fixedTax: 0,
    total: 118000,
    untaxedBase: 0,
    rows: [
      { code: 'TVA18', name: 'TVA', type: 'PERCENT', rate: '18', base: 100000, amount: 18000 },
    ],
  },
  lines: [
    {
      id: 'l1',
      folioId: 'f1',
      businessDate: '2026-01-02',
      type: 'ROOM',
      departmentCode: 'HEB',
      label: 'Nuitée',
      qty: 1,
      currency: 'XOF',
      unitAmount: 100000,
      amount: 100000,
      taxAmount: 18000,
      productId: null,
      sourceType: 'room_night',
      sourceId: null,
      reversalOfId: null,
      reversedById: null,
      createdAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'l2',
      folioId: 'f1',
      businessDate: '2026-01-02',
      type: 'TAX',
      departmentCode: null,
      label: 'TVA 18 %',
      qty: 1,
      currency: 'XOF',
      unitAmount: 18000,
      amount: 18000,
      taxAmount: 0,
      productId: null,
      sourceType: 'tax',
      sourceId: 'l1',
      reversalOfId: null,
      reversedById: null,
      createdAt: '2026-01-02T00:00:00Z',
    },
  ],
  payments: [],
  ...over,
});

const RATES = {
  items: [
    { id: 'r1', base: 'EUR', quote: 'XOF', rate: '655.957', validOn: '2026-01-02', updatedAt: '' },
  ],
};

function setup(ui: React.ReactElement, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <HmThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </HmThemeProvider>,
  );
  return { qc, ...view };
}

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  handlers.clear();
  signIn();
  useMeStore.setState({ me: ME });
  usePropertyStore.setState({ id: 'p1' });
  vi.stubGlobal('crypto', { randomUUID: () => 'key-1' });
});
afterEach(() => {
  signOut();
  vi.unstubAllGlobals();
});

describe('model', () => {
  it('nests tax lines under their charge, grouped by business date', () => {
    const g = groupLines(folio().lines);
    expect(g).toHaveLength(1);
    expect(g[0]!.nodes).toHaveLength(1);
    expect(g[0]!.nodes[0]!.children.map((c) => c.id)).toEqual(['l2']);
    expect(g[0]!.total).toBe(118000);
  });
  it('converts a EUR tender to XOF with integers', () => {
    expect(convertTender(200, '655.957', 'EUR', 'XOF')).toBe(1312);
  });
});

describe('payment form', () => {
  it('shows the rate, the converted amount and the change live for a EUR tender', async () => {
    const f = folio({ balance: 1000 });
    stubApi({ 'GET /exchange-rates': () => json(200, RATES) });
    setup(<PaymentForm folio={f} onPaid={() => undefined} />);
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Devise remise' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('combobox', { name: 'Devise remise' }));
    await user.click(await screen.findByTitle('EUR'));
    await user.type(screen.getByLabelText('Montant remis (EUR)'), '5');
    // 5 EUR = 3 280 XOF, 1 000 due -> change 2 280
    expect((await screen.findByTestId('change')).textContent).toMatch(/2.280/);
    expect(screen.getByTestId('converted').textContent).toMatch(/3.280/);
    expect(screen.getByText(/1 EUR = 655.957 XOF/)).toBeInTheDocument();
  });

  it('shows the reference conflict on the reference field and sends an Idempotency-Key', async () => {
    const f = folio();
    const calls = stubApi({
      'GET /exchange-rates': () => json(200, { items: [] }),
      'POST /folios/f1/payments': () =>
        json(409, {
          title: 'Conflict',
          status: 409,
          code: 'CONFLICT',
          meta: { reason: 'DUPLICATE_REFERENCE' },
        }),
    });
    setup(<PaymentForm folio={f} onPaid={() => undefined} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Mixx by Yas'));
    await user.type(screen.getByLabelText('Référence (facultatif)'), 'TX42');
    await user.click(screen.getByRole('button', { name: 'Encaisser' }));
    expect(await screen.findByText(/déjà utilisée par un autre paiement/)).toBeInTheDocument();
    const sent = calls.find((c) => c.method === 'POST')!;
    expect(sent.body).toMatchObject({ method: 'MIXX', amount: 118000, reference: 'TX42' });
    expect(JSON.stringify(sent.headers)).toMatch(/idempotency-key/i);
  });
});

describe('folio page', () => {
  const mount = () =>
    setup(
      <Routes>
        <Route path="/folios/:id" element={<FolioPage />} />
      </Routes>,
      '/folios/f1',
    );
  const routes = (f: Folio) => ({
    'GET /folios/f1': () => json(200, f),
    'GET /folios': () => json(200, { items: [], nextCursor: null }),
    'GET /exchange-rates': () => json(200, { items: [] }),
    'GET /invoices': () => json(200, { items: [], nextCursor: null }),
    'GET /products': () => json(200, { items: [], nextCursor: null }),
  });

  it('offers discount and reversal only with their permissions', async () => {
    signIn({ permissions: ['folio.read', 'folio.pay'] });
    stubApi(routes(folio()));
    mount();
    await screen.findByText('Nuitée');
    expect(screen.queryByRole('button', { name: 'Remise' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Contre-passer' })).not.toBeInTheDocument();
  });

  it('shows them to a manager', async () => {
    signIn({ permissions: ['folio.read', 'folio.discount', 'folio.reverse'] });
    stubApi(routes(folio()));
    mount();
    await screen.findByText('Nuitée');
    expect(screen.getByRole('button', { name: 'Remise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contre-passer' })).toBeInTheDocument();
  });

  it('refetches the folio on folio.changed of its property', async () => {
    const calls = stubApi(routes(folio()));
    mount();
    await screen.findByText('Nuitée');
    const count = () =>
      calls.filter((c) => c.method === 'GET' && c.url.includes('/folios/f1')).length;
    const before = count();
    await waitFor(() => expect(handlers.has('folio.changed')).toBe(true));
    handlers.get('folio.changed')!({ propertyId: 'p1', folioId: 'f1', action: 'payment' });
    await waitFor(() => expect(count()).toBeGreaterThan(before));
  });
});

describe('invoice issue flow', () => {
  it('previews totals per tax rate, issues the invoice and offers the PDF', async () => {
    const inv = {
      id: 'i1',
      number: 'FAC-2026-0001',
      total: 118000,
      currency: 'XOF',
      customer: { email: 'a@b.tg' },
    } as Invoice;
    const calls = stubApi({ 'POST /invoices': () => json(201, inv) });
    setup(<InvoiceDialog folio={folio()} open onClose={() => undefined} />);
    expect(screen.getByText('TVA (18 %)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Émettre la facture' }));
    expect(await screen.findByText('Facture FAC-2026-0001 émise')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      folioId: 'f1',
      sendEmail: false,
    });
    expect(screen.getByRole('button', { name: 'Télécharger le PDF' })).toBeInTheDocument();
  });
});

describe('cash close', () => {
  const session: CashSession = {
    id: 'c1',
    propertyId: 'p1',
    userId: 'u1',
    status: 'OPEN',
    currency: 'XOF',
    openingFloat: 10000,
    openedAt: '2026-01-02T08:00:00Z',
    closedAt: null,
    expectedAmount: 50000,
    countedAmount: null,
    variance: null,
    note: null,
    expected: [{ method: 'CASH', currency: 'XOF', expected: 50000 }],
  };
  const renderClose = () => {
    stubApi({});
    setup(
      <CloseSessionModal
        session={session}
        open
        onClose={() => undefined}
        onClosed={() => undefined}
      />,
    );
  };

  it('blocks a closing with variance without cash.close_with_variance', async () => {
    signIn({ permissions: ['cash.session', 'cash.close'] });
    renderClose();
    await userEvent.type(screen.getByLabelText('Montant compté (Espèces)'), '49000');
    expect((await screen.findByTestId('variance-CASH:XOF')).textContent).toMatch(/-1.000/);
    expect(screen.getByText(/seul un responsable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clôturer la caisse' })).toBeDisabled();
  });

  it('lets a manager close with a variance', async () => {
    signIn({ permissions: ['cash.session', 'cash.close', 'cash.close_with_variance'] });
    renderClose();
    await userEvent.type(screen.getByLabelText('Montant compté (Espèces)'), '49000');
    await screen.findByText(/tracé dans l'audit/);
    expect(screen.getByRole('button', { name: 'Clôturer la caisse' })).toBeEnabled();
  });

  it('lets anyone close with no variance', async () => {
    signIn({ permissions: ['cash.session', 'cash.close'] });
    renderClose();
    await userEvent.type(screen.getByLabelText('Montant compté (Espèces)'), '50000');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clôturer la caisse' })).toBeEnabled(),
    );
  });
});

describe('taxLabel', () => {
  it('never doubles the percent already stated by the tax name', () => {
    expect(taxLabel('TVA 18 %', '18')).toBe('TVA 18 %');
    expect(taxLabel('TVA', '18')).toBe('TVA (18 %)');
    expect(taxLabel('Taxe de séjour', null)).toBe('Taxe de séjour');
    expect(taxLabel('TVA 7.5 %', '7.5')).toBe('TVA 7.5 %');
  });
});
