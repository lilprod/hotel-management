import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore, useUiStore } from '@hm/ui';

import { App } from '../App';
import i18n from '../i18n';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(brandingStatus: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/branding'))
        return brandingStatus === 200
          ? json(200, {
              primaryColor: '#0a7a3c',
              secondaryColor: '#102a43',
              assets: { logo: { url: '/logo.png' } },
            })
          : json(brandingStatus, { title: 'Unauthorized' });
      if (url.includes('/lodging/properties'))
        return json(200, {
          items: [{ id: 'p1', name: 'Hôtel Ahoefa Palace', currency: 'XOF', country: 'TG' }],
        });
      return json(404, {});
    }),
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  useSessionStore.setState({ features: ['*'], permissions: ['*'] });
  await i18n.changeLanguage('fr');
});
afterEach(() => vi.unstubAllGlobals());

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <App />
    </MemoryRouter>,
  );

describe('tenant branding in the staff shell', () => {
  it('shows the tenant logo and hotel name in the sidebar header', async () => {
    stub(200);
    renderApp();
    const block = screen.getByTestId('brand-block');
    await waitFor(() => expect(within(block).getByText('Hôtel Ahoefa Palace')).toBeInTheDocument());
    expect(block.querySelector('img')).toHaveAttribute('src', '/logo.png');
  });

  it('keeps the default theme and logo-less header when the branding call is refused', async () => {
    stub(401);
    renderApp();
    const block = screen.getByTestId('brand-block');
    await waitFor(() => expect(within(block).getByText('Hôtel Ahoefa Palace')).toBeInTheDocument());
    expect(block.querySelector('img')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();
  });
});
