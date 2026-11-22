import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { json, signIn, signOut, stubApi } from '../test-utils';
import { DemoDataPanel } from './DemoDataPanel';
import { ResponsiveSteps } from './ResponsiveSteps';
import { DashboardPage } from './DashboardPage';
import { OnboardingPage } from './OnboardingPage';
import { resetRedirect } from './redirect';
import type { OnboardingView } from './api';

const PID = '11111111-1111-4111-8111-111111111111';
const RT = '22222222-2222-4222-8222-222222222222';

function view(over: Partial<OnboardingView> = {}): OnboardingView {
  return {
    status: 'in_progress',
    step: 0,
    completedSteps: [],
    updatedAt: null,
    finishedAt: null,
    demo: {
      loaded: false,
      loadedAt: null,
      counts: { rates: 0, ratePlans: 0, rooms: 0, roomTypes: 0, products: 0, guests: 0 },
    },
    facts: {
      propertyId: PID,
      property: false,
      roomTypes: 1,
      rooms: 0,
      ratePlans: 0,
      rates: 0,
      taxes: 1,
      team: false,
      branding: false,
    },
    ...over,
  };
}

/** Stateful fake of the onboarding API + the lodging APIs the steps read. */
function server(initial: OnboardingView, extra: Record<string, (b: unknown) => Response> = {}) {
  let state = initial;
  const routes: Record<string, (b: unknown) => Response> = {
    'GET /onboarding': () => json(200, state),
    'PUT /onboarding': (b) => {
      const p = b as {
        step?: number;
        completedSteps?: number[];
        status?: OnboardingView['status'];
      };
      state = {
        ...state,
        ...(p.step !== undefined ? { step: p.step } : {}),
        ...(p.status ? { status: p.status } : {}),
        completedSteps: [...new Set([...state.completedSteps, ...(p.completedSteps ?? [])])],
      };
      return json(200, state);
    },
    [`GET /lodging/properties/${PID}`]: () =>
      json(200, {
        id: PID,
        name: 'Hôtel du Lac',
        address: null,
        city: 'Lomé',
        country: 'TG',
        phone: null,
        taxId: null,
        rccm: null,
        currency: 'XOF',
        timezone: 'Africa/Lome',
        checkinTime: '14:00',
        checkoutTime: '12:00',
      }),
    'PATCH ': () => json(200, {}),
    'GET /lodging/room-types': () =>
      json(200, { items: [{ id: RT, code: 'STD', name: 'Standard', maxAdults: 2, beds: null }] }),
    'GET /lodging/rooms': () => json(200, { items: [] }),
    'GET /billing/subscription': () =>
      json(200, {
        quotas: [{ key: 'units', used: 18, limit: 20 }],
        features: [],
        today: '2026-11-20',
      }),
    ...extra,
  };
  const calls = stubApi(routes);
  return { calls, get: () => state };
}

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/dashboard" element={<div>dashboard-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  signIn();
  resetRedirect();
});
afterEach(() => {
  signOut();
  vi.unstubAllGlobals();
});

describe('onboarding wizard', () => {
  it('resumes at the saved step and saves the progress when moving back and forth', async () => {
    const api = server(view({ step: 2, completedSteps: [0, 1] }));
    renderWizard();
    // Resumed on step 3 "Chambres".
    expect(await screen.findByText('Étape 3 sur 8')).toBeInTheDocument();
    expect(screen.getByText(/Créez vos chambres par plage/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(await screen.findByText('Étape 2 sur 8')).toBeInTheDocument();
    expect(api.get().step).toBe(1);

    await userEvent.click(await screen.findByRole('button', { name: /Suivant/ }));
    expect(await screen.findByText('Étape 3 sur 8')).toBeInTheDocument();
    const put = api.calls.filter((c) => c.method === 'PUT').at(-1);
    expect(put?.body).toMatchObject({ step: 2, completedSteps: [1] });
  });

  it('starts at the first step with the stored property pre-filled, then saves it on Next', async () => {
    const api = server(view());
    renderWizard();
    expect(await screen.findByText('Étape 1 sur 8')).toBeInTheDocument();
    const name = await screen.findByLabelText(/Nom de l'établissement/);
    await waitFor(() => expect(name).toHaveValue('Hôtel du Lac'));
    await userEvent.type(screen.getByLabelText('Adresse'), 'Boulevard du Mono');
    await userEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    await screen.findByText('Étape 2 sur 8');
    const patch = api.calls.find(
      (c) => c.method === 'PATCH' && c.url.endsWith(`/lodging/properties/${PID}`),
    );
    expect(patch?.body).toMatchObject({
      name: 'Hôtel du Lac',
      address: 'Boulevard du Mono',
      checkinTime: '14:00',
    });
  });

  it('does not move on when the step is invalid', async () => {
    server(view());
    renderWizard();
    const name = await screen.findByLabelText(/Nom de l'établissement/);
    await waitFor(() => expect(name).toHaveValue('Hôtel du Lac'));
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    expect(await screen.findByText("Saisissez le nom de l'établissement.")).toBeInTheDocument();
    expect(screen.getByText('Étape 1 sur 8')).toBeInTheDocument();
  });

  it('lets the owner skip a step without saving it as completed', async () => {
    const api = server(view({ step: 3 }));
    renderWizard();
    await screen.findByText('Étape 4 sur 8');
    await userEvent.click(screen.getByRole('button', { name: 'Passer cette étape' }));
    await screen.findByText('Étape 5 sur 8');
    expect(api.get().completedSteps).toEqual([]);
  });

  it('skipping the wizard marks it skipped and goes to the dashboard', async () => {
    const api = server(view());
    renderWizard();
    await screen.findByText('Étape 1 sur 8');
    await userEvent.click(screen.getByRole('button', { name: "Passer l'assistant" }));
    const buttons = await screen.findAllByRole('button', { name: "Passer l'assistant" });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(await screen.findByText('dashboard-page')).toBeInTheDocument();
    expect(api.get().status).toBe('skipped');
  });

  it('shows the quota error returned by the bulk room creation', async () => {
    const api = server(view({ step: 2 }), {
      'POST /lodging/rooms/bulk': () =>
        json(402, {
          title: 'Quota exceeded',
          code: 'QUOTA_EXCEEDED',
          status: 402,
          meta: { quota: 'units', limit: 20, used: 18 },
        }),
    });
    renderWizard();
    await screen.findByText('Étape 3 sur 8');
    // The quota bar is displayed.
    const quota = await screen.findByTestId('units-quota');
    expect(within(quota).getByText('18 / 20')).toBeInTheDocument();
    expect(within(quota).getByText(/2 chambre\(s\) encore disponibles/)).toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText('De'), '101');
    await userEvent.type(screen.getByLabelText('À'), '105');
    await userEvent.click(screen.getByRole('button', { name: 'Créer les chambres Standard' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Quota atteint : votre offre autorise 20 chambre(s) et 18 existent déjà',
    );
    const post = api.calls.find((c) => c.url.endsWith('/lodging/rooms/bulk'));
    expect(post?.body).toMatchObject({ propertyId: PID, roomTypeId: RT, from: 101, to: 105 });
  });

  it('creates rooms and confirms the count', async () => {
    server(view({ step: 2 }), {
      'POST /lodging/rooms/bulk': () => json(201, { created: 5, items: [] }),
    });
    renderWizard();
    await userEvent.type(await screen.findByLabelText('De'), '101');
    await userEvent.type(screen.getByLabelText('À'), '105');
    expect(screen.getByText('5 chambre(s) : 101 à 105')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Créer les chambres Standard' }));
    expect(await screen.findByText('5 chambre(s) créée(s).')).toBeInTheDocument();
  });

  it('rejects an inverted range before calling the API', async () => {
    const api = server(view({ step: 2 }));
    renderWizard();
    await userEvent.type(await screen.findByLabelText('De'), '110');
    await userEvent.type(screen.getByLabelText('À'), '101');
    await userEvent.click(screen.getByRole('button', { name: 'Créer les chambres Standard' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/« À » doit être supérieur/);
    expect(api.calls.some((c) => c.url.endsWith('/lodging/rooms/bulk'))).toBe(false);
  });

  describe('recap and demonstration data', () => {
    it('finishes without demo data by default', async () => {
      const api = server(view({ step: 7, completedSteps: [0, 1, 2, 3, 4, 5, 6] }));
      renderWizard();
      const toggle = await screen.findByRole('checkbox', {
        name: /Charger des données de démonstration/,
      });
      expect(toggle).not.toBeChecked();
      await userEvent.click(screen.getByRole('button', { name: 'Terminer la configuration' }));
      expect(await screen.findByText('dashboard-page')).toBeInTheDocument();
      expect(api.calls.some((c) => c.url.endsWith('/onboarding/demo-data'))).toBe(false);
      expect(api.get().status).toBe('completed');
    });

    it('loads the demo data when the option is ticked', async () => {
      const api = server(view({ step: 7 }), {
        'POST /onboarding/demo-data': () =>
          json(201, {
            loaded: true,
            loadedAt: 'x',
            counts: { rooms: 7, roomTypes: 2, guests: 5, products: 3, rates: 2, ratePlans: 1 },
          }),
      });
      renderWizard();
      await userEvent.click(
        await screen.findByRole('checkbox', { name: /Charger des données de démonstration/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Terminer la configuration' }));
      expect(await screen.findByText('dashboard-page')).toBeInTheDocument();
      const idx = (m: string, end: string) =>
        api.calls.findIndex((c) => c.method === m && c.url.endsWith(end));
      expect(idx('POST', '/onboarding/demo-data')).toBeGreaterThan(-1);
      const completed = api.calls.findIndex(
        (c) =>
          c.method === 'PUT' && (c.body as { status?: string } | undefined)?.status === 'completed',
      );
      expect(completed).toBeGreaterThan(idx('POST', '/onboarding/demo-data'));
    });

    it('stays on the recap and shows the quota error when the demo rooms do not fit', async () => {
      const api = server(view({ step: 7 }), {
        'POST /onboarding/demo-data': () =>
          json(402, {
            title: 'Quota',
            code: 'QUOTA_EXCEEDED',
            status: 402,
            meta: { quota: 'units', limit: 20, used: 18 },
          }),
      });
      renderWizard();
      await userEvent.click(
        await screen.findByRole('checkbox', { name: /Charger des données de démonstration/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Terminer la configuration' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Quota atteint');
      expect(api.get().status).toBe('in_progress');
      expect(screen.queryByText('dashboard-page')).not.toBeInTheDocument();
    });
  });
});

describe('dashboard checklist', () => {
  function renderDashboard() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/onboarding" element={<div>wizard-page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('sends the owner to the wizard once while it is in progress', async () => {
    server(view());
    renderDashboard();
    expect(await screen.findByText('wizard-page')).toBeInTheDocument();
  });

  it('shows the checklist card after a skip, and hides it once completed', async () => {
    server(view({ status: 'skipped', completedSteps: [0, 1] }));
    const first = renderDashboard();
    const card = await screen.findByTestId('onboarding-checklist');
    expect(within(card).getByText('Terminer la configuration')).toBeInTheDocument();
    expect(within(card).getByText('Assistant passé')).toBeInTheDocument();
    expect(within(card).getByText(/3 étape\(s\) sur 7 terminée\(s\)/)).toBeInTheDocument();
    first.unmount();
    vi.unstubAllGlobals();

    server(view({ status: 'completed' }));
    renderDashboard();
    await screen.findByRole('heading', { level: 1, name: 'Tableau de bord' });
    await waitFor(() =>
      expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument(),
    );
  });

  it('counts "Ajouter votre logo" as done only when a logo was uploaded', async () => {
    // the branding step was passed / finished (6 completed) but no logo exists
    server(view({ status: 'skipped', completedSteps: [6] }));
    const first = renderDashboard();
    const card = await screen.findByTestId('onboarding-checklist');
    expect(within(card).getByText(/2 étape\(s\) sur 7 terminée\(s\)/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Ajouter votre logo/ })).toBeInTheDocument();
    first.unmount();
    vi.unstubAllGlobals();

    const withLogo = view({ status: 'skipped', completedSteps: [] });
    withLogo.facts.branding = true;
    server(withLogo);
    renderDashboard();
    const card2 = await screen.findByTestId('onboarding-checklist');
    expect(within(card2).getByText(/3 étape\(s\) sur 7 terminée\(s\)/)).toBeInTheDocument();
    expect(within(card2).queryByRole('button', { name: /Ajouter votre logo/ })).toBeNull();
  });

  it('does not query the wizard for users without settings.manage', async () => {
    signIn({ permissions: ['reservations.read'] });
    const api = server(view());
    renderDashboard();
    await screen.findByRole('heading', { level: 1, name: 'Tableau de bord' });
    expect(api.calls.some((c) => c.url.endsWith('/onboarding'))).toBe(false);
  });
});

describe('demo data settings panel', () => {
  it('deletes the demo data on confirmation', async () => {
    let demoLoaded = true;
    const api = server(
      view({
        status: 'completed',
        demo: {
          loaded: true,
          loadedAt: 'x',
          counts: { rooms: 7, roomTypes: 2, guests: 5, products: 3, rates: 2, ratePlans: 1 },
        },
      }),
      {
        'DELETE /onboarding/demo-data': () => {
          demoLoaded = false;
          return json(200, { removed: {} });
        },
      },
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DemoDataPanel />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(/7 chambres, 2 types, 5 clients, 3 produits/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer les données de démo' }));
    const confirm = await screen.findAllByRole('button', { name: 'Supprimer les données de démo' });
    await userEvent.click(confirm.at(-1)!);
    await waitFor(() => expect(demoLoaded).toBe(false));
    expect(
      api.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/onboarding/demo-data')),
    ).toBe(true);
    expect(await screen.findByText('Données de démonstration supprimées.')).toBeInTheDocument();
  });
});

describe('ResponsiveSteps', () => {
  const labels = ['Établissement', 'Types de chambre', 'Image de marque'];
  it('shows the full labels in the wide layout and numbered dots with tooltips when compact', () => {
    const wide = render(<ResponsiveSteps labels={labels} current={1} compact={false} />);
    for (const l of labels) expect(wide.getByText(l)).toBeInTheDocument();
    wide.unmount();
    const small = render(<ResponsiveSteps labels={labels} current={1} compact />);
    expect(small.getByTestId('steps-compact')).toBeInTheDocument();
    expect(small.getByRole('img', { name: 'Types de chambre' })).toBeInTheDocument();
    expect(small.getByText('3')).toBeInTheDocument();
    expect(small.getByRole('img', { name: 'Image de marque' }).closest('li')).not.toHaveAttribute(
      'aria-current',
    );
    expect(small.getByRole('img', { name: 'Types de chambre' }).closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });
});
