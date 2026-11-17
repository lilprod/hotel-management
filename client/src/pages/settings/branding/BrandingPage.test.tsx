import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HmThemeProvider } from '@hm/ui';

import i18n from '../../../i18n';
import { BrandingPage } from './BrandingPage';

const VIEW = {
  primaryColor: '#7a5a14',
  secondaryColor: '#1f2a37',
  docHeader: null,
  docFooter: null,
  legalMentions: null,
  emailSenderName: null,
  loginMessage: null,
  legal: { legalForm: null, nif: null, rccm: null, taxRegime: null, address: null },
  assets: {},
  contrast: { warnings: [] },
  defaults: {
    primaryColor: '#7a5a14',
    secondaryColor: '#1f2a37',
    legalMentions: '',
    taxRegimes: ['RNI', 'RSI', 'TPU'],
  },
};
const calls: { method: string; url: string; body?: unknown }[] = [];
let domainStatus = 402;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  calls.length = 0;
  domainStatus = 402;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url,
        ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
      });
      if (url.endsWith('/branding/domain'))
        return domainStatus === 200
          ? json(200, { subdomain: { hostname: 'x.hm.test' }, custom: null })
          : json(402, { title: 'Payment required', detail: 'Feature not in plan' });
      if (url.endsWith('/branding') && method === 'PUT') return json(200, VIEW);
      if (url.endsWith('/branding')) return json(200, VIEW);
      if (url.includes('/assets/') && method === 'POST')
        return json(422, {
          errors: [{ path: 'file', message: 'Image is 8x8px; allowed 32x32 to 2000x2000' }],
        });
      if (url.endsWith('/templates/catalog'))
        return json(200, {
          items: [
            {
              code: 'reservation.confirmation',
              channels: ['EMAIL'],
              variables: [{ key: 'guest.firstName', sample: 'Kossi' }],
            },
          ],
        });
      if (url.endsWith('/templates/preview'))
        return json(200, { subject: null, body: 'Bonjour &lt;b&gt;' });
      if (url.includes('/templates')) return json(200, { items: [] });
      return json(404, {});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HmThemeProvider>
        <BrandingPage />
      </HmThemeProvider>
    </QueryClientProvider>,
  );
}

describe('BrandingPage', () => {
  it('hides the custom domain tab when the feature is not in the plan', async () => {
    renderPage();
    await screen.findByLabelText('Couleur principale');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/branding/domain'))).toBe(true));
    expect(screen.queryByRole('tab', { name: 'Domaine personnalisé' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Modèles de messages' })).toBeInTheDocument();
  });

  it('shows the custom domain tab when the feature is enabled', async () => {
    domainStatus = 200;
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Domaine personnalisé' })).toBeInTheDocument();
  });

  it('validates colors with Zod and does not call the API', async () => {
    const user = userEvent.setup();
    renderPage();
    const primary = await screen.findByLabelText('Couleur principale');
    await waitFor(() => expect(primary).toHaveValue('#7a5a14'));
    await user.clear(primary);
    await user.type(primary, 'rouge');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Couleur attendue au format #RRGGBB')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('updates the live preview, warns on low contrast and saves', async () => {
    const user = userEvent.setup();
    renderPage();
    const primary = await screen.findByLabelText('Couleur principale');
    await waitFor(() => expect(primary).toHaveValue('#7a5a14'));
    await user.clear(primary);
    await user.type(primary, '#808080');
    expect(await screen.findByRole('alert')).toHaveTextContent(/texte blanc/);
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ primaryColor: '#808080', docHeader: null });
    expect(await screen.findByText('Image de marque enregistrée')).toBeInTheDocument();
  });

  it('shows the server message when an upload is rejected', async () => {
    renderPage();
    await screen.findByLabelText('Couleur principale');
    const input = screen.getByTestId('asset-input');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText(/allowed 32x32/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/assets/logo'))).toBe(true);
  });

  it('previews a template through the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Modèles de messages' }));
    await user.click(await screen.findByRole('button', { name: 'Nouveau modèle' }));
    await user.click(screen.getByRole('combobox', { name: 'Code' }));
    await user.click(
      await screen.findByText('reservation.confirmation', {
        selector: '.ant-select-item-option-content',
      }),
    );
    await user.type(screen.getByLabelText('Message'), 'Bonjour {{guest.firstName}}');
    await waitFor(
      () => expect(calls.some((c) => c.url.endsWith('/templates/preview'))).toBe(true),
      { timeout: 3000 },
    );
    expect(await screen.findByText('Bonjour &lt;b&gt;')).toBeInTheDocument();
  });
});
