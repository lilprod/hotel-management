import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import { useMeStore } from '../../auth/session';
import i18n from '../../i18n';
import { usePropertyStore } from '../../reservations/property';
import { ME, signIn, signOut } from '../../test-utils';
import { CheckInDrawer } from './CheckInDrawer';
import type { CheckInTarget } from './CheckInDrawer';
import { CheckOutDrawer } from './CheckOutDrawer';
import { FrontDeskPage } from './FrontDeskPage';

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ on: () => undefined, off: () => undefined, disconnect: () => undefined })),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

/** Route table `"METHOD /path"` → response, matching on the path (query string ignored). */
function stubApi(routes: Record<string, (call: Call) => Response>) {
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

function setup(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HmThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </HmThemeProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  signIn({ permissions: ['front_desk.read', 'front_desk.check_in', 'front_desk.check_out'] });
  useMeStore.setState({ me: ME });
  usePropertyStore.setState({ id: 'p1' });
});
afterEach(() => {
  signOut();
  vi.unstubAllGlobals();
});

const row = (over: Record<string, unknown> = {}) => ({
  reservationId: 'r1',
  reservationRoomId: 'rr1',
  stayId: null,
  number: 'RES-2026-000001',
  status: 'CONFIRMED',
  guest: { id: 'g1', name: 'AGBEKO Kofi', phone: null, email: null },
  companyName: null,
  roomTypeId: 't1',
  roomTypeName: 'Standard',
  roomId: 'room101',
  roomNumber: '101',
  hkStatus: 'CLEAN',
  arrival: '2026-11-12',
  departure: '2026-11-14',
  adults: 2,
  children: 0,
  late: false,
  balance: null,
  currency: 'XOF',
  ...over,
});

describe('FrontDeskPage', () => {
  const summary = {
    businessDate: '2026-11-12',
    date: '2026-11-12',
    arrivals: 2,
    departures: 1,
    inHouse: 3,
    noShows: 1,
    availableCleanRooms: 7,
  };

  it('shows the KPI header, the tab counts and the lists with their quick actions', async () => {
    const calls = stubApi({
      'GET /front-desk/summary': () => json(200, summary),
      'GET /front-desk/arrivals': () =>
        json(200, {
          businessDate: '2026-11-12',
          date: '2026-11-12',
          items: [row(), row({ reservationRoomId: 'rr2', number: 'RES-2026-000002', late: true, guest: { id: 'g2', name: 'MENSAH Ama', phone: null, email: null } })],
        }),
      'GET /front-desk/in-house': () =>
        json(200, {
          businessDate: '2026-11-12',
          date: '2026-11-12',
          items: [row({ status: 'CHECKED_IN', stayId: 's1', balance: 36_000 })],
        }),
    });
    setup(<FrontDeskPage />);

    expect(await screen.findByRole('tab', { name: 'Arrivées (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Départs (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Présents (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Non-présentations (1)' })).toBeInTheDocument();
    expect(screen.getByText('Chambres propres libres')).toBeInTheDocument();
    expect(await screen.findByText('AGBEKO Kofi')).toBeInTheDocument();
    expect(screen.getByText('En retard')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Check-in/ })).toHaveLength(2);

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Présents (3)' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/front-desk/in-house'))).toBe(true));
    expect(await screen.findByRole('button', { name: /Check-out/ })).toBeInTheDocument();
    expect(screen.getByText(/36\D000/)).toBeInTheDocument();
  });

  it('sends the search term to the list and hides the actions the user cannot perform', async () => {
    signIn({ permissions: ['front_desk.read'] });
    const calls = stubApi({
      'GET /front-desk/summary': () => json(200, summary),
      'GET /front-desk/arrivals': () => json(200, { businessDate: '2026-11-12', date: '2026-11-12', items: [row()] }),
    });
    setup(<FrontDeskPage />);
    await screen.findByText('AGBEKO Kofi');
    expect(screen.queryByRole('button', { name: /Check-in/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Client sans réservation' })).toBeNull();

    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: /Rechercher/ }), 'agbeko{Enter}');
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/front-desk/arrivals') && c.url.includes('search=agbeko'))).toBe(true),
    );
  });
});

describe('CheckInDrawer', () => {
  const target: CheckInTarget = {
    propertyId: 'p1',
    reservationId: 'r1',
    reservationRoomId: 'rr1',
    number: 'RES-2026-000001',
    guestId: 'g1',
    guestName: 'AGBEKO Kofi',
    roomTypeId: 't1',
    roomTypeName: 'Standard',
    roomId: 'room101',
    roomNumber: '101',
    hkStatus: 'DIRTY',
    arrival: '2026-11-12',
    departure: '2026-11-14',
    adults: 2,
    children: 0,
    currency: 'XOF',
  };
  const rooms = [
    { id: 'room101', number: '101', roomTypeId: 't1', roomTypeName: 'Standard', floor: null, hkStatus: 'DIRTY', clean: false },
    { id: 'room102', number: '102', roomTypeId: 't1', roomTypeName: 'Standard', floor: null, hkStatus: 'CLEAN', clean: true },
  ];
  const profile = {
    id: 'g1',
    firstName: 'Kofi',
    lastName: 'Agbeko',
    birthDate: null,
    birthPlace: null,
    nationality: null,
    profession: null,
    address: null,
    idDocType: 'PASSPORT',
    idDocNumberMasked: '••••4567',
  };

  const routes = (post?: (c: Call) => Response) => ({
    'GET /lodging/properties/p1': () => json(200, { businessDate: '2026-11-12' }),
    'GET /guests/g1': () => json(200, profile),
    'GET /front-desk/available-rooms': () => json(200, rooms),
    'GET /custom-fields/definitions': () => json(200, { items: [] }),
    'POST /front-desk/stays': post ?? (() => json(201, {})),
  });

  it('suggests clean rooms, flags dirty ones, validates the police form before sending anything', async () => {
    const calls = stubApi(
      routes(() =>
        json(201, {
          stayId: 's1',
          reservationRoomId: 'rr1',
          reservationId: 'r1',
          roomId: 'room102',
          roomNumber: '102',
          policeRecordIds: ['p1'],
          deposit: null,
          notified: false,
          warnings: [],
        }),
      ),
    );
    const onDone = vi.fn();
    setup(<CheckInDrawer target={target} onClose={() => undefined} onDone={onDone} />);
    const user = userEvent.setup();

    // 1. reservation, then 2. room
    expect(await screen.findByText('AGBEKO Kofi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    const dirty = await screen.findByRole('radio', { name: /101/ });
    const clean = screen.getByRole('radio', { name: /102/ });
    expect(screen.getByText(/À nettoyer/)).toBeInTheDocument();
    // dirty room: not selectable without front_desk.override_dirty, and the next step stays locked
    expect(dirty).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeDisabled();
    await user.click(clean);
    await user.click(screen.getByRole('button', { name: 'Suivant' }));

    // 3. identity prefilled from the profile; missing police fields refuse the next step
    expect(await screen.findByDisplayValue('Agbeko')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••4567/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(4);
    expect(alerts[0]).toHaveTextContent('Champ obligatoire pour la fiche de police.');
    expect(screen.getByText('Identité et fiche de police')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Lieu de naissance' }), { target: { value: 'Lomé' } });
    fireEvent.change(screen.getByLabelText('Date de naissance'), { target: { value: '1985-03-02' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nationalité (code pays)' }), { target: { value: 'tg' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Domicile habituel' }), { target: { value: 'Rue 1, Lomé' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Provenance' }), { target: { value: 'Accra' } });
    await user.click(screen.getByRole('button', { name: 'Suivant' }));

    // 4. deposit (not allowed without folio.pay), 5. confirmation
    expect(await screen.findByText(/pas le droit d'encaisser/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmer le check-in' }));

    expect(await screen.findByText('Check-in effectué — chambre 102')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/front-desk/stays'))!;
    expect(post.body).toMatchObject({
      reservationRoomId: 'rr1',
      roomId: 'room102',
      overrideDirty: false,
      guests: [
        {
          guestId: 'g1',
          lastName: 'Agbeko',
          birthPlace: 'Lomé',
          birthDate: '1985-03-02',
          nationality: 'TG',
          address: 'Rue 1, Lomé',
        },
      ],
      police: { provenance: 'Accra' },
    });
    expect(JSON.stringify(post.body)).not.toContain('••••');
    expect(onDone).toHaveBeenCalled();
  });

  it('lets a user holding override_dirty check a guest into a dirty room, and shows the server refusal', async () => {
    signIn({ permissions: ['front_desk.read', 'front_desk.check_in', 'front_desk.override_dirty'] });
    stubApi(
      routes(() =>
        json(409, {
          title: 'Conflict',
          code: 'CONFLICT',
          detail: 'Room 101 is not clean',
          meta: { reason: 'ROOM_NOT_CLEAN' },
        }),
      ),
    );
    setup(
      <CheckInDrawer
        target={{ ...target, guestId: null }}
        onClose={() => undefined}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Suivant' }));
    const dirty = await screen.findByRole('radio', { name: /101/ });
    expect(dirty).toBeEnabled();
    await user.click(dirty);
    expect(await screen.findByRole('checkbox', { name: /dérogation/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /dérogation/ }));
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeEnabled();
  });
});

describe('CheckOutDrawer', () => {
  const preview = (over: Record<string, unknown> = {}) => ({
    stayId: 's1',
    reservationRoomId: 'rr1',
    reservationId: 'r1',
    reservationNumber: 'RES-2026-000001',
    roomNumber: '101',
    businessDate: '2026-11-13',
    arrival: '2026-11-12',
    departure: '2026-11-13',
    currency: 'XOF',
    earlyDeparture: false,
    folios: [{ id: 'f1', number: 'RES-2026-000001-1-1', status: 'OPEN', balance: 36_000, currency: 'XOF', chargesTotal: 36_000, paymentsTotal: 0 }],
    summary: [
      { department: 'ROOM', amount: 30_000 },
      { department: 'TVA18', amount: 6_000 },
    ],
    chargesTotal: 36_000,
    paymentsTotal: 0,
    balance: 36_000,
    blockers: [{ code: 'UNPAID_BALANCE', message: 'Folio has an unpaid balance', folioId: 'f1', amount: 36_000 }],
    canCheckout: false,
    ...over,
  });

  it('lists the blockers and keeps the check-out locked until the balance is dealt with', async () => {
    stubApi({ 'POST /front-desk/stays/s1/checkout-preview': () => json(200, preview()) });
    setup(<CheckOutDrawer stayRef="s1" onClose={() => undefined} />);
    expect(await screen.findByText('Le check-out est bloqué')).toBeInTheDocument();
    expect(screen.getByText(/Solde impayé : 36\D000/)).toBeInTheDocument();
    expect(screen.getByTestId('checkout-balance')).toHaveTextContent(/36\D000/);
    expect(screen.getByRole('table', { name: 'Récapitulatif du folio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check-out impossible' })).toBeDisabled();
    // no folio.pay / checkout_with_balance permission: no payment, transfer or override section
    expect(screen.queryByText('Encaissement rapide')).toBeNull();
    expect(screen.queryByText(/autorisation spéciale/)).toBeNull();
  });

  it('forces the check-out with a reason for a user holding checkout_with_balance', async () => {
    signIn({ permissions: ['front_desk.check_out', 'front_desk.checkout_with_balance'] });
    const calls = stubApi({
      'POST /front-desk/stays/s1/checkout-preview': () => json(200, preview()),
      'POST /front-desk/stays/s1/checkout': () =>
        json(200, {
          stayId: 's1',
          reservationStatus: 'CHECKED_OUT',
          balance: 36_000,
          transferred: 0,
          overridden: ['UNPAID_BALANCE'],
          invoices: [],
          notified: false,
          warnings: [],
        }),
    });
    setup(<CheckOutDrawer stayRef="s1" onClose={() => undefined} />);
    const user = userEvent.setup();
    const reason = await screen.findByRole('textbox', { name: /Motif obligatoire/ });
    expect(screen.getByRole('button', { name: 'Check-out impossible' })).toBeDisabled();
    await user.type(reason, 'Accord du directeur');
    const force = await screen.findByRole('button', { name: 'Forcer le check-out avec solde' });
    expect(force).toBeEnabled();
    await user.click(force);
    expect(await screen.findByText('Check-out effectué')).toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith('/stays/s1/checkout'))!;
    expect(post.body).toMatchObject({ overrideReason: 'Accord du directeur', earlyDeparture: false });
    expect(post.body).not.toHaveProperty('transferToCompanyId');
  });

  it('confirms directly when the folio is settled and asks to confirm an early departure', async () => {
    const calls = stubApi({
      'POST /front-desk/stays/s1/checkout-preview': () =>
        json(200, preview({ balance: 0, blockers: [], canCheckout: true, earlyDeparture: true, folios: [] })),
      'POST /front-desk/stays/s1/checkout': () =>
        json(200, { stayId: 's1', reservationStatus: 'COMPLETED', balance: 0, transferred: 0, overridden: [], invoices: [{ id: 'i1', number: 'FA-2026-000001', total: 36_000 }], notified: true, warnings: [] }),
    });
    setup(<CheckOutDrawer stayRef="s1" onClose={() => undefined} />);
    const user = userEvent.setup();
    const confirm = await screen.findByRole('button', { name: 'Confirmer le check-out' });
    expect(confirm).toBeDisabled(); // early departure not confirmed yet
    await user.click(screen.getByRole('checkbox', { name: /Départ anticipé/ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    const done = await screen.findByText('Check-out effectué');
    expect(within(done.closest('.ant-result') as HTMLElement).getByText(/Facture FA-2026-000001 émise/)).toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith('/stays/s1/checkout'))!;
    expect(post.body).toMatchObject({ earlyDeparture: true, invoice: { issue: true } });
  });
});
