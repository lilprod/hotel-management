import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import { useMeStore } from '../../auth/session';
import i18n from '../../i18n';
import { usePropertyStore } from '../../reservations/property';
import { ME, signIn, signOut } from '../../test-utils';
import { localizeLabel } from '../billing/model';
import type { Audit, Precheck } from './api';
import { defaultDecisions, stepStatuses } from './api';
import { NightAuditPage } from './NightAuditPage';

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
}
function stubApi(routes: Record<string, (c: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const call: Call = {
        method,
        url,
        ...(init?.body ? { body: JSON.parse(init.body as string) as Record<string, unknown> } : {}),
      };
      calls.push(call);
      const path = url.split('?')[0]!;
      const key = Object.keys(routes).find((k) => {
        const [m, suffix] = k.split(' ') as [string, string];
        return m === method && path.endsWith(suffix);
      });
      return Promise.resolve(key ? routes[key]!(call) : json(404, { title: 'nf', code: 'NOT_FOUND' }));
    }),
  );
  return calls;
}

const PRECHECK: Precheck = {
  propertyId: 'p1',
  businessDate: '2026-11-12',
  closedDate: '2026-11-11',
  running: null,
  canRun: true,
  checks: [
    {
      code: 'PENDING_ARRIVALS',
      severity: 'DECISION',
      count: 1,
      items: [
        {
          reservationId: 'r1',
          reservationRoomId: 'rr1',
          number: 'RES-1',
          guestName: 'KODJO Ama',
          roomNumber: '102',
          arrival: '2026-11-12',
          departure: '2026-11-14',
          currency: 'XOF',
          penalty: { amount: 60000, currency: 'XOF' },
          canNoShow: true,
        },
      ],
    },
    {
      code: 'PENDING_DEPARTURES',
      severity: 'WARNING',
      count: 1,
      items: [
        {
          reservationId: 'r2',
          reservationRoomId: 'rr2',
          stayId: 's2',
          number: 'RES-2',
          guestName: 'MENSAH Kossi',
          roomNumber: '103',
          arrival: '2026-11-10',
          departure: '2026-11-12',
          balance: 0,
          currency: 'XOF',
        },
      ],
    },
    {
      code: 'OPEN_CASH_SESSIONS',
      severity: 'WARNING',
      count: 1,
      items: [{ cashSessionId: 'c1', userId: 'u1', userName: 'Afi', openedAt: '2026-11-12T07:00:00Z' }],
    },
    { code: 'NEGATIVE_BALANCES', severity: 'WARNING', count: 0, items: [] },
    { code: 'UNASSIGNED_IN_HOUSE', severity: 'WARNING', count: 0, items: [] },
  ],
};

const AUDIT: Audit = {
  id: 'a1',
  propertyId: 'p1',
  businessDate: '2026-11-12',
  status: 'COMPLETED',
  trigger: 'manual',
  startedBy: 'u1',
  startedAt: '2026-11-13T02:00:00Z',
  completedAt: '2026-11-13T02:01:00Z',
  steps: (['no_shows', 'room_nights', 'lock_day', 'stats', 'advance_date', 'report', 'notify'] as const).map((step) => ({
    step,
    status: 'done' as const,
    at: '2026-11-13T02:00:30Z',
    error: null,
  })),
  decisions: [{ reservationId: 'r1', action: 'NO_SHOW' }],
  warnings: [],
  kpis: {
    businessDate: '2026-11-12',
    currency: 'XOF',
    roomsAvailable: 4,
    roomsSold: 2,
    occupancy: '50.0',
    roomRevenue: 70000,
    totalRevenue: 133000,
    adr: 35000,
    revpar: 17500,
    revenueByDept: { ROOM: 70000, NO_SHOW: 60000, MINIBAR: 3000 },
    taxes: [{ code: 'TVA18', name: 'TVA 18 %', kind: 'VAT', amount: 12600 }],
    vatTotal: 12600,
    touristTaxTotal: 0,
    payments: [{ method: 'CARD', amount: 20000 }],
    paymentsTotal: 20000,
    arrivals: 2,
    departures: 0,
    inHouse: 2,
    noShows: 1,
  },
  reportFileId: 'f1',
  error: null,
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HmThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/night-audit']}>
          <NightAuditPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HmThemeProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  handlers.clear();
  signIn();
  useMeStore.setState({ me: ME });
  usePropertyStore.setState({ id: 'p1' });
});
afterEach(() => {
  signOut();
  vi.unstubAllGlobals();
});

describe('model', () => {
  it('keeps every pending arrival by default and overlays live progress on the known steps', () => {
    expect(defaultDecisions(PRECHECK)).toEqual({ r1: { reservationId: 'r1', action: 'KEEP' } });
    const failed = { steps: AUDIT.steps.map((s) => (s.step === 'stats' ? { ...s, status: 'failed' as const } : s.step === 'advance_date' || s.step === 'report' || s.step === 'notify' ? { ...s, status: 'pending' as const } : s)) };
    const st = stepStatuses(failed, { stats: 'running' });
    expect(st).toMatchObject({ no_shows: 'finish', stats: 'process', advance_date: 'wait' });
    expect(stepStatuses(failed, {}).stats).toBe('error');
  });

  it('formats ISO days inside folio labels in the UI language', () => {
    expect(localizeLabel('Hébergement — nuit du 2026-11-22', 'fr')).toBe('Hébergement — nuit du 22/11/2026');
    expect(localizeLabel('Eau minérale', 'fr')).toBe('Eau minérale');
  });
});

describe('night audit screen', () => {
  it('shows the business date and the pre-checks with their actions (penalty preview, check-out, cash)', async () => {
    stubApi({
      'GET /night-audit/precheck': () => json(200, PRECHECK),
      'GET /night-audit': () => json(200, { items: [], nextCursor: null }),
    });
    setup();
    expect(await screen.findByTestId('business-date')).toHaveTextContent('12 nov. 2026');
    expect(screen.getByText(/Dernière journée clôturée : 11 nov. 2026/)).toBeInTheDocument();
    const arrivals = screen.getByTestId('check-PENDING_ARRIVALS');
    expect(within(arrivals).getByText('Décision requise')).toBeInTheDocument();
    expect(within(arrivals).getByText(/60.000/)).toBeInTheDocument();
    expect(within(arrivals).getByText('KODJO Ama')).toBeInTheDocument();
    const deps = screen.getByTestId('check-PENDING_DEPARTURES');
    expect(within(deps).getByRole('link', { name: 'Aller au départ' })).toHaveAttribute('href', '/front-desk?tab=departures');
    expect(within(screen.getByTestId('check-OPEN_CASH_SESSIONS')).getByRole('link', { name: 'Clôturer la session' })).toHaveAttribute('href', '/cash');
    expect(within(screen.getByTestId('check-NEGATIVE_BALANCES')).getByText('Rien à signaler')).toBeInTheDocument();
    expect(screen.getByText('Aucun audit pour l’instant.'.replace('’', "'"))).toBeInTheDocument();
  });

  it('extends a departure from the pre-check list', async () => {
    const calls = stubApi({
      'GET /night-audit/precheck': () => json(200, PRECHECK),
      'GET /night-audit': () => json(200, { items: [], nextCursor: null }),
      'POST /reservations/r2/extend': () => json(200, {}),
    });
    setup();
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId('check-PENDING_DEPARTURES')).getByRole('button', { name: 'Prolonger' }));
    const input = await screen.findByLabelText('Nouvelle date de départ');
    expect(input).toHaveValue('2026-11-13');
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/reservations/r2/extend'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/extend'))?.body).toEqual({ departure: '2026-11-13' });
  });

  it('sends the no-show decision, shows the live progress per step, then the day summary', async () => {
    let finish: (r: Response) => void = () => undefined;
    const calls = stubApi({
      'GET /night-audit/precheck': () => json(200, PRECHECK),
      'GET /night-audit': () => json(200, { items: [], nextCursor: null }),
      'POST /night-audit/run': () => new Promise<Response>((res) => (finish = res)),
    });
    setup();
    const user = userEvent.setup();
    const arrivals = await screen.findByTestId('check-PENDING_ARRIVALS');
    await user.click(within(arrivals).getByText('Non-présentation'));
    expect(within(arrivals).getByText('Sans pénalité')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Lancer l'audit/ }));
    expect(await screen.findByText('1 non-présentation avec pénalité')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      propertyId: 'p1',
      businessDate: '2026-11-12',
      decisions: [{ reservationId: 'r1', action: 'NO_SHOW' }],
    });

    // Realtime progress (`night_audit.progress` on the property room).
    const progress = await screen.findByTestId('run-progress');
    const emit = (step: string, status: string) =>
      act(() => handlers.get('night_audit.progress')?.({ propertyId: 'p1', auditId: 'a1', businessDate: '2026-11-12', step, index: 0, total: 7, status }));
    emit('no_shows', 'done');
    emit('room_nights', 'running');
    await waitFor(() => expect(progress.querySelectorAll('.ant-steps-item-finish')).toHaveLength(1));
    expect(progress.querySelectorAll('.ant-steps-item-process')).toHaveLength(1);
    expect(within(progress).getByText('Report des nuitées')).toBeInTheDocument();
    // Another property's progress is ignored.
    act(() => handlers.get('night_audit.progress')?.({ propertyId: 'p2', step: 'stats', status: 'done' }));
    expect(progress.querySelectorAll('.ant-steps-item-finish')).toHaveLength(1);

    await act(async () => finish(json(200, { audit: AUDIT, alreadyCompleted: false })));
    const summary = await screen.findByTestId('audit-summary');
    expect(within(summary).getByText('Synthèse du 12 nov. 2026')).toBeInTheDocument();
    expect(within(summary).getByText('50.0 %')).toBeInTheDocument();
    expect(within(summary).getByText('2 / 4')).toBeInTheDocument();
    expect(within(summary).getByText('Pénalités de no-show')).toBeInTheDocument();
    expect(within(summary).getByText('TVA 18 % (TVA)')).toBeInTheDocument();
    await waitFor(() => expect(progress.querySelectorAll('.ant-steps-item-finish')).toHaveLength(7));
  });

  it('blocks the run on blocking checks and hides it without the permission', async () => {
    stubApi({
      'GET /night-audit/precheck': () =>
        json(200, {
          ...PRECHECK,
          canRun: false,
          checks: PRECHECK.checks.map((c) => (c.code === 'OPEN_CASH_SESSIONS' ? { ...c, severity: 'BLOCKING' } : c)),
        }),
      'GET /night-audit': () => json(200, { items: [AUDIT], nextCursor: null }),
      'GET /night-audit/a1/report': () => json(200, { fileId: 'f1', url: 'https://files.test/r.pdf' }),
    });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    setup();
    expect(await screen.findByText('Des contrôles bloquants doivent être traités avant de lancer l’audit.'.replace('’', "'"))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lancer l'audit/ })).toBeDisabled();
    expect(within(screen.getByTestId('check-OPEN_CASH_SESSIONS')).getByText('Bloquant')).toBeInTheDocument();
    // History with the PDF of the day report.
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rapport PDF 2026-11-12' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://files.test/r.pdf', '_blank', 'noopener'));
  });

  it('tells a user without night_audit.run that they cannot run it', async () => {
    signIn({ permissions: ['night_audit.read'] });
    stubApi({
      'GET /night-audit/precheck': () => json(200, PRECHECK),
      'GET /night-audit': () => json(200, { items: [], nextCursor: null }),
    });
    setup();
    expect(await screen.findByText("Vous n'avez pas le droit de lancer l'audit de nuit.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lancer l'audit/ })).toBeDisabled();
  });
});
