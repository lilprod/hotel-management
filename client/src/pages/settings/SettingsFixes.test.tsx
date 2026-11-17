import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import i18n from '../../i18n';
import { BrandingPage } from './branding/BrandingPage';
import { SettingsPage } from './SettingsPage';

const PROPERTY = { id: 'p1', name: 'Hôtel Test', country: 'TG', currency: 'XOF' };
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

let ratePlans: unknown[] = [];
const calls: string[] = [];
const BRANDING = {
  primaryColor: '#7a5a14',
  secondaryColor: '#cccccc',
  docHeader: null,
  docFooter: null,
  legalMentions: null,
  emailSenderName: null,
  loginMessage: null,
  legal: { legalForm: null, nif: null, rccm: null, taxRegime: null, address: null },
  assets: {},
  contrast: {
    warnings: [
      {
        code: 'SECONDARY_LOW_CONTRAST_WHITE',
        message: 'White text on the secondary colour is 1.6:1 (WCAG AA needs 4.5:1).',
        ratio: 1.6,
      },
    ],
  },
  defaults: {
    primaryColor: '#7a5a14',
    secondaryColor: '#1f2a37',
    legalMentions: '',
    taxRegimes: [],
  },
};

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  ratePlans = [];
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/lodging/properties')) return json({ items: [PROPERTY] });
      if (url.includes('/lodging/rooms'))
        return json({
          items: [
            { id: 'r1', number: '101', roomTypeId: 't1', floor: '1', hkStatus: 'DIRTY' },
            { id: 'r2', number: '102', roomTypeId: 't1', floor: '1', hkStatus: 'IN_PROGRESS' },
          ],
        });
      if (url.includes('/lodging/room-types'))
        return json({ items: [{ id: 't1', code: 'STD', name: 'Standard' }] });
      if (url.includes('/pricing/rate-plans')) return json({ items: ratePlans });
      if (url.includes('/pricing/rates?')) return json({ items: [] });
      if (url.endsWith('/branding')) return json(BRANDING);
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

describe('settings display fixes', () => {
  it('translates housekeeping statuses instead of showing raw enums', async () => {
    const user = userEvent.setup();
    wrap(<SettingsPage />);
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('tab', { name: 'Chambres' }));
    expect(await screen.findByText('Sale')).toHaveAttribute('data-status', 'dirty');
    expect(screen.getByText('En cours')).toBeInTheDocument();
    expect(screen.queryByText('DIRTY')).not.toBeInTheDocument();
    expect(screen.queryByText('IN_PROGRESS')).not.toBeInTheDocument();
  });

  it('translates housekeeping statuses in English', async () => {
    await i18n.changeLanguage('en');
    const user = userEvent.setup();
    wrap(<SettingsPage />);
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('tab', { name: 'Rooms' }));
    expect(await screen.findByText('Dirty')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('shows an empty state with a CTA when there is no rate plan', async () => {
    const user = userEvent.setup();
    wrap(<SettingsPage />);
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('tab', { name: 'Tarifs' }));
    expect(await screen.findByText('Aucun plan tarifaire')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Créer un plan tarifaire' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('preselects the first rate plan and loads its grid', async () => {
    ratePlans = [
      { id: 'rp1', code: 'BAR', name: 'Tarif public', mealPlan: 'BB' },
      { id: 'rp2', code: 'CORP', name: 'Entreprise', mealPlan: 'RO' },
    ];
    const user = userEvent.setup();
    wrap(<SettingsPage />);
    await screen.findByText('Hôtel Test');
    await user.click(screen.getByRole('tab', { name: 'Tarifs' }));
    await waitFor(() =>
      expect(calls.some((c) => c.includes('/pricing/rates?ratePlanId=rp1'))).toBe(true),
    );
    expect(await screen.findByText('Prix / nuit', { selector: 'th' })).toBeInTheDocument();
    expect(screen.getAllByText('Petit-déjeuner').length).toBeGreaterThan(0);
  });

  it('builds the contrast warning from i18n keys and the numeric ratio', async () => {
    wrap(<BrandingPage />);
    expect(
      await screen.findByText(
        "Le texte blanc sur la couleur secondaire n'atteint que 1,60:1 (WCAG AA exige 4,5:1).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/White text/)).not.toBeInTheDocument();
  });
});
