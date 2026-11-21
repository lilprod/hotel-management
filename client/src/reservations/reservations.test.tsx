import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import { useMeStore } from '../auth/session';
import i18n from '../i18n';
import { ME, signIn, signOut } from '../test-utils';
import { NewReservationWizard } from './NewReservationWizard';
import { PlanningPage } from './PlanningPage';
import { ReservationDrawer } from './ReservationDrawer';
import { addDays } from './api';
import type { PlanningData } from './api';
import { usePropertyStore } from './property';

// ── fake Socket.io client ──
const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const socket = {
    on: (e: string, h: (...a: unknown[]) => void) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
    },
    off: (e: string, h: (...a: unknown[]) => void) => handlers.get(e)?.delete(h),
    disconnect: () => undefined,
  };
  return {
    socket,
    handlers,
    emit: (e: string, ...a: unknown[]) => handlers.get(e)?.forEach((h) => h(...a)),
    io: vi.fn(() => socket),
  };
});
vi.mock('socket.io-client', () => ({ io: socketMock.io }));

const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const planning = (): PlanningData => ({
  propertyId: 'p1',
  from: addDays(today, -2),
  to: addDays(today, 29),
  businessDate: today,
  roomTypes: [
    {
      id: 't1',
      code: 'STD',
      name: 'Standard',
      rooms: [
        { id: 'room101', number: '101', floor: '1', building: null, hkStatus: 'CLEAN' },
        { id: 'room102', number: '102', floor: '1', building: null, hkStatus: 'CLEAN' },
      ],
      freeByNight: [],
    },
  ],
  segments: [
    {
      id: 's1',
      reservationId: 'r1',
      number: 'R-0001',
      roomId: 'room101',
      roomTypeId: 't1',
      guestName: 'Awa Koffi',
      status: 'CONFIRMED',
      arrival: today,
      departure: addDays(today, 3),
      adults: 2,
      children: 0,
      groupId: null,
      colorKey: 'confirmed',
    },
  ],
  blocks: [],
});

function setup(ui: React.ReactElement, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HmThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </HmThemeProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  signIn();
  useMeStore.setState({ me: ME });
  usePropertyStore.setState({ id: 'p1' });
  socketMock.handlers.clear();
});
afterEach(() => {
  signOut();
  vi.unstubAllGlobals();
});

// Geometry of the timeline under jsdom: label 150, cell 44, header 38 + 24, group row 28, row 34.
const cellX = (slot: number) => 150 + slot * 44 + 22;
const ROW_101_Y = 62 + 28 + 17;
const ROW_102_Y = 62 + 28 + 34 + 17;
const mouse = (target: Element | Window, type: string, x: number, y: number) =>
  fireEvent(target, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));

describe('PlanningPage', () => {
  it('rolls the optimistic move back and lists the clashing nights on a 409', async () => {
    let planningReads = 0;
    let rejectMove: (() => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.split('?')[0]!;
        if (path.endsWith('/planning')) {
          planningReads += 1;
          return json(200, planning());
        }
        if (path.endsWith('/rooms/s1/move') && init?.method === 'POST') {
          await new Promise<void>((resolve) => (rejectMove = resolve));
          return json(409, {
            title: 'Conflict',
            code: 'CONFLICT',
            detail: 'The requested unit is not available on some nights',
            meta: {
              reason: 'UNIT_UNAVAILABLE',
              clashes: [
                { roomId: 'room102', date: addDays(today, 1), reason: 'OCCUPIED' },
                { roomId: 'room102', date: addDays(today, 2), reason: 'OCCUPIED' },
              ],
              short: [],
            },
          });
        }
        return json(404, { title: 'nf' });
      }),
    );
    const { container } = setup(<PlanningPage />);
    await waitFor(() => expect(container.querySelector('[data-tl-seg="s1"]')).toBeInTheDocument());
    expect(
      container.querySelector('[data-tl-row="room101"] [data-tl-seg="s1"]'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Planning des chambres/)).toBeInTheDocument();

    // drag s1 from room 101 to room 102 (same dates: grab the first night = slot 2)
    const seg = container.querySelector('[data-tl-seg="s1"]')!;
    mouse(seg, 'pointerdown', cellX(2), ROW_101_Y);
    mouse(window, 'pointermove', cellX(2), ROW_102_Y);
    expect(container.querySelector('[data-tl-ghost="move"]')).toBeInTheDocument();
    mouse(window, 'pointerup', cellX(2), ROW_102_Y);

    // optimistic: the segment is already in the target row while the request is pending
    await waitFor(() =>
      expect(
        container.querySelector('[data-tl-row="room102"] [data-tl-seg="s1"]'),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(rejectMove).not.toBeNull());
    await act(async () => rejectMove!());

    // rollback + clear message with the clashing nights
    await waitFor(() =>
      expect(
        container.querySelector('[data-tl-row="room101"] [data-tl-seg="s1"]'),
      ).toBeInTheDocument(),
    );
    expect(container.querySelector('[data-tl-row="room102"] [data-tl-seg="s1"]')).toBeNull();
    const alert = await screen.findByText(/Déplacement impossible/);
    const box = alert.closest('.ant-alert') as HTMLElement;
    expect(within(box).getByText(/Chambre 102/)).toHaveTextContent(/déjà occupée/);
    expect(planningReads).toBeGreaterThanOrEqual(2); // refetched after the failure
  });

  it('extends a stay when the end edge is dragged (extend API)', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.split('?')[0]!;
        if (path.endsWith('/planning')) return json(200, planning());
        if (init?.method === 'POST') {
          calls.push({ url: path, body: JSON.parse(init.body as string) });
          return json(200, { reservation: {}, warnings: [] });
        }
        return json(404, {});
      }),
    );
    const { container } = setup(<PlanningPage />);
    await waitFor(() => expect(container.querySelector('[data-tl-handle]')).toBeInTheDocument());
    const handle = container.querySelector('[data-tl-handle]')!;
    mouse(handle, 'pointerdown', 150 + 5 * 44 - 3, ROW_101_Y);
    mouse(window, 'pointermove', 150 + 7 * 44, ROW_101_Y);
    mouse(window, 'pointerup', 150 + 7 * 44, ROW_101_Y);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toMatch(/\/reservations\/r1\/extend$/);
    expect(calls[0]!.body).toEqual({ departure: addDays(today, 5) });
  });

  it('refetches the planning when planning.changed arrives for the property', async () => {
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.split('?')[0]!.endsWith('/planning')) {
          reads += 1;
          return json(200, planning());
        }
        return json(404, {});
      }),
    );
    setup(<PlanningPage />);
    await waitFor(() => expect(reads).toBe(1));
    await waitFor(() => expect(socketMock.handlers.get('event')?.size).toBe(1));

    // another property: ignored
    act(() =>
      socketMock.emit('event', { type: 'planning.changed', payload: { propertyId: 'other' } }),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(reads).toBe(1);

    // our property (relayed envelope): refetch
    act(() =>
      socketMock.emit('event', {
        type: 'planning.changed',
        payload: { propertyId: 'p1', from: today, to: today },
      }),
    );
    await waitFor(() => expect(reads).toBe(2));
  });
});

describe('ReservationDrawer: cancellation', () => {
  const arrival = addDays(today, 3);
  const reservation = {
    id: 'r1',
    propertyId: 'p1',
    number: 'R-0001',
    status: 'CONFIRMED',
    channel: 'FRONT_DESK',
    source: null,
    segment: null,
    arrival,
    departure: addDays(arrival, 2),
    adults: 2,
    children: 0,
    notes: null,
    optionExpiresAt: null,
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    groupId: null,
    companyId: null,
    isAllotment: false,
    booker: {
      id: 'g1',
      firstName: 'Awa',
      lastName: 'Koffi',
      phone: null,
      email: null,
      isBlacklisted: false,
    },
    currency: 'XOF',
    roomTotal: 100000,
    penalty: null,
    customFields: {},
    rooms: [
      {
        id: 'l1',
        roomTypeId: 't1',
        roomId: null,
        roomNumber: null,
        ratePlanId: 'rp1',
        arrival,
        departure: addDays(arrival, 2),
        adults: 2,
        children: 0,
        status: 'CONFIRMED',
        currency: 'XOF',
        dailyPrices: [
          { date: arrival, base: 50000, extraAdultAmount: 0, extraChildAmount: 0, total: 50000 },
          {
            date: addDays(arrival, 1),
            base: 50000,
            extraAdultAmount: 0,
            extraChildAmount: 0,
            total: 50000,
          },
        ],
        total: 100000,
        guests: [],
      },
    ],
    createdAt: '',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('shows the computed penalty BEFORE confirming, then cancels with the chosen reason', async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.split('?')[0]!;
        if (init?.method === 'POST') {
          posted.push({ url: path, body: JSON.parse(init.body as string) });
          return json(200, { reservation: { ...reservation, status: 'CANCELLED' }, penalty: {} });
        }
        if (path.endsWith('/reservations/r1')) return json(200, { reservation, warnings: [] });
        if (path.endsWith('/lodging/properties/p1'))
          return json(200, { id: 'p1', businessDate: today });
        if (path.endsWith('/pricing/rate-plans'))
          return json(200, {
            items: [
              { id: 'rp1', code: 'BB', name: 'BB', cancellationPolicyId: 'pol1', isActive: true },
            ],
            nextCursor: null,
          });
        if (path.endsWith('/pricing/policies'))
          return json(200, {
            items: [
              {
                id: 'pol1',
                kind: 'CANCELLATION',
                rules: {
                  tiers: [
                    { daysBefore: 7, penaltyPercent: 0 },
                    { daysBefore: 2, penaltyPercent: 50 },
                  ],
                  noShowPercent: 100,
                  firstNightMinimum: false,
                },
              },
            ],
            nextCursor: null,
          });
        if (path.endsWith('/lookups/cancel_reason'))
          return json(200, {
            items: [
              { id: 'c1', code: 'GUEST_REQUEST', label: { fr: 'Demande du client' }, active: true },
            ],
          });
        if (path.endsWith('/lodging/room-types'))
          return json(200, { items: [{ id: 't1', code: 'STD', name: 'Standard' }] });
        if (path.includes('/lookups/') || path.includes('/custom-fields'))
          return json(200, { items: [] });
        return json(404, {});
      }),
    );
    setup(<ReservationDrawer id="r1" onClose={() => undefined} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Annuler la réservation' }));

    // 3 days before arrival: tier 2 days = 50 % of 100 000 → 50 000, shown before any POST
    const preview = await screen.findByTestId('penalty-preview');
    await waitFor(() => expect(preview).toHaveTextContent(/50\D000/));
    expect(preview).toHaveTextContent(/50 %/);
    expect(posted).toHaveLength(0);

    const confirm = screen.getByRole('button', {
      name: 'Confirmer l’annulation'.replace('’', "'"),
    });
    expect(confirm).toBeDisabled(); // a reason is required
    await user.click(screen.getByRole('combobox', { name: "Motif d'annulation" }));
    await user.click(await screen.findByText('Demande du client'));
    await user.click(confirm);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toMatch(/\/reservations\/r1\/cancel$/);
    expect(posted[0]!.body).toEqual({ reasonCode: 'GUEST_REQUEST', waivePenalty: false });
  });
});

describe('NewReservationWizard', () => {
  const availability = (sellable: boolean) => ({
    propertyId: 'p1',
    arrival: today,
    departure: addDays(today, 2),
    nights: 2,
    roomTypes: [
      {
        roomTypeId: 't1',
        code: 'STD',
        name: 'Standard',
        maxAdults: 3,
        maxChildren: 1,
        totalUnits: 5,
        fitsOccupancy: true,
        freeByNight: [],
        minFree: sellable ? 3 : 0,
        sellable,
        ratePlans: [
          {
            ratePlanId: 'rp1',
            code: 'BB',
            name: 'Petit-déjeuner',
            mealPlan: 'BB',
            isPublic: true,
            available: sellable,
            reason: sellable ? null : 'NO_AVAILABILITY',
            message: null,
            quote: sellable ? { currency: 'XOF', nights: 2, roomTotal: 90000, total: 90000 } : null,
          },
        ],
      },
    ],
  });

  const stubWizardApi = (
    sellable: boolean,
    posted: { url: string; body: unknown; headers: Record<string, string> }[],
  ) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.split('?')[0]!;
        if (init?.method === 'POST') {
          posted.push({
            url: path,
            body: JSON.parse(init.body as string),
            headers: (init.headers ?? {}) as Record<string, string>,
          });
          return path.endsWith('/waitlist')
            ? json(201, { id: 'w1' })
            : json(201, { reservation: { id: 'r9', number: 'R-0009' }, warnings: [] });
        }
        if (path.endsWith('/availability')) return json(200, availability(sellable));
        if (path.includes('/lookups/') || path.includes('/custom-fields'))
          return json(200, { items: [] });
        return json(404, {});
      }),
    );

  it('walks dates → availability → rooms → guest → details → summary → create with an Idempotency-Key', async () => {
    const posted: { url: string; body: unknown; headers: Record<string, string> }[] = [];
    stubWizardApi(true, posted);
    setup(
      <NewReservationWizard
        initial={{ propertyId: 'p1', arrival: today, departure: addDays(today, 2) }}
      />,
    );
    const user = userEvent.setup();

    // starts on the availability step (dates prefilled): prices by rate plan
    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(await screen.findByText(/90\D000/)).toBeInTheDocument();
    const next = () => screen.getByRole('button', { name: 'Suivant' });
    expect(next()).toBeDisabled(); // no room selected yet
    const qty = screen.getByRole('spinbutton', { name: /Nombre de chambres Standard/ });
    await user.clear(qty);
    await user.type(qty, '2');
    await user.tab();
    await waitFor(() => expect(next()).toBeEnabled());
    expect(screen.getByText(/2 chambre\(s\) sélectionnée\(s\)/)).toHaveTextContent(/180\D000/);
    await user.click(next());

    // guest: new profile
    await user.click(screen.getByText('Nouveau client'));
    await user.type(screen.getByRole('textbox', { name: 'Prénom' }), 'Awa');
    await user.type(screen.getByRole('textbox', { name: 'Nom' }), 'Koffi');
    await user.click(next());

    // details: PENDING option
    await user.click(screen.getByText('Option (en attente)'));
    await user.click(next());

    // summary with the total, then create
    expect(screen.getByTestId('grand-total')).toHaveTextContent(/180\D000/);
    await user.click(screen.getByRole('button', { name: 'Créer la réservation' }));
    await screen.findByText(/Réservation R-0009 créée/);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toMatch(/\/reservations$/);
    expect(posted[0]!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    const body = posted[0]!.body as { rooms: unknown[]; status: string; guest: unknown };
    expect(body.rooms).toHaveLength(2);
    expect(body.status).toBe('PENDING');
    expect(body.guest).toEqual({ firstName: 'Awa', lastName: 'Koffi' });
  });

  it('offers the waitlist when nothing is available', async () => {
    const posted: { url: string; body: unknown; headers: Record<string, string> }[] = [];
    stubWizardApi(false, posted);
    setup(
      <NewReservationWizard
        initial={{ propertyId: 'p1', arrival: today, departure: addDays(today, 2) }}
      />,
    );
    const user = userEvent.setup();
    expect(await screen.findByText('Aucune disponibilité sur ces dates.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Rejoindre la liste d'attente" }));
    await user.click(screen.getByText('Nouveau client'));
    await user.type(screen.getByRole('textbox', { name: 'Prénom' }), 'Awa');
    await user.type(screen.getByRole('textbox', { name: 'Nom' }), 'Koffi');
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await user.click(screen.getByRole('button', { name: "Ajouter à la liste d'attente" }));
    await screen.findByText("Client ajouté à la liste d'attente");
    expect(posted[0]!.url).toMatch(/\/waitlist$/);
  });
});
