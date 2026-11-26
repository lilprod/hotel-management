import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import i18n from '../../i18n';
import { localName, localizeTypes } from '../../reservations/refs';
import { roomTypeFormValues, roomTypePayload } from './rooms/RoomsPage';
import { SettingsPage } from './SettingsPage';

const PROPERTY = { id: 'p1', name: 'Hôtel Test', country: 'TG', currency: 'XOF' };
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const ROOM_TYPE = {
  id: 't1',
  code: 'STD',
  name: 'Standard',
  description: 'Vue jardin',
  nameI18n: { fr: 'Standard', en: 'Standard room' },
  descriptionI18n: { fr: 'Vue jardin', en: 'Garden view' },
  maxAdults: 2,
  maxChildren: 0,
  baseOccupancy: 2,
};
const RATE = {
  id: 'rate1',
  roomTypeId: 't1',
  seasonId: null,
  dowMask: 127,
  price: 30_000,
  extraAdult: 0,
  extraChild: 0,
  minStay: 1,
  maxStay: 7,
  closedToArrival: false,
  closedToDeparture: true,
};
const calls: { method: string; url: string; body?: unknown }[] = [];

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url,
        ...(init?.body ? { body: JSON.parse(init.body as string) } : {}),
      });
      if (init?.method && init.method !== 'GET') return json({});
      if (url.includes('/lodging/properties')) return json({ items: [PROPERTY] });
      if (url.includes('/lodging/room-types')) return json({ items: [ROOM_TYPE] });
      if (url.includes('/pricing/rate-plans'))
        return json({ items: [{ id: 'rp1', code: 'BAR', name: 'Tarif public', mealPlan: 'BB' }] });
      if (url.includes('/pricing/rates?')) return json({ items: [RATE] });
      return json({ items: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HmThemeProvider>{node}</HmThemeProvider>
    </QueryClientProvider>,
  );
}

describe('rate grid: stay restrictions (max stay, CTA, CTD)', () => {
  it('shows and edits max stay and the closed-to-arrival / departure flags', async () => {
    const user = userEvent.setup();
    wrap(<SettingsPage />);
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('tab', { name: 'Tarifs' }));
    const label = 'Séjour max. STD Hors saison';
    // The cells remount once the rates are loaded: query them afterwards.
    await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue('7'));
    const maxStay = screen.getByLabelText(label);
    const cta = screen.getByLabelText("Fermé à l'arrivée STD Hors saison");
    const ctd = screen.getByLabelText('Fermé au départ STD Hors saison');
    expect(cta).not.toBeChecked();
    expect(ctd).toBeChecked();

    await user.click(cta);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        url: expect.stringContaining('/pricing/rates/rate1'),
        body: { closedToArrival: true },
      }),
    );
    // An emptied max stay removes the limit (null).
    await user.clear(maxStay);
    fireEvent.blur(maxStay);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        url: expect.stringContaining('/pricing/rates/rate1'),
        body: { maxStay: null },
      }),
    );
  });
});

describe('room types: French / English name and description', () => {
  it('edits the translations in the room type form', async () => {
    const user = userEvent.setup();
    wrap(<SettingsPage />);
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('tab', { name: 'Chambres' }));
    expect(await screen.findByText('Standard room')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Types de chambre' });
    await user.click(within(section).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Nom (français)')).toHaveValue('Standard');
    const en = within(dialog).getByLabelText('Nom (anglais)');
    expect(en).toHaveValue('Standard room');
    expect(within(dialog).getByLabelText('Description (anglais)')).toHaveValue('Garden view');
    await user.clear(en);
    await user.type(en, 'Standard double');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        name: 'Standard',
        nameI18n: { fr: 'Standard', en: 'Standard double' },
        descriptionI18n: { fr: 'Vue jardin', en: 'Garden view' },
      }),
    );
  });

  it('maps the form values to the API payload and back', () => {
    expect(
      roomTypePayload({ code: 'DLX', name: 'Deluxe', nameEn: '', maxAdults: 2 }, false),
    ).toEqual({
      code: 'DLX',
      name: 'Deluxe',
      maxAdults: 2,
      nameI18n: { fr: 'Deluxe' },
      descriptionI18n: null,
    });
    expect(roomTypeFormValues(ROOM_TYPE)).toMatchObject({
      nameEn: 'Standard room',
      descriptionEn: 'Garden view',
    });
  });

  it('displays the localized room type name (planning / reservations)', () => {
    expect(localName(ROOM_TYPE, 'en-GB')).toBe('Standard room');
    expect(localName(ROOM_TYPE, 'fr')).toBe('Standard');
    expect(localName({ name: 'Suite', nameI18n: {} }, 'en')).toBe('Suite');
    expect(localizeTypes([ROOM_TYPE], 'en').map((x) => x.name)).toEqual(['Standard room']);
  });
});
