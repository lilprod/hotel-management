import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contrastRatio, useUiStore } from '@hm/ui/core';

import { App } from '../App';
import i18n from '../i18n';
import { defaultPortalBranding, toPortalBranding } from './api';
import type { PublicBranding } from './api';

const PUBLIC: PublicBranding = {
  name: 'Hôtel Aurore',
  colors: { primary: '#0b5d3b', secondary: '#102a43', onPrimary: '#ffffff' },
  logoUrl: '/api/v1/portal/branding/assets/logo',
  logoDarkUrl: null,
  faviconUrl: 'https://files.test/favicon.png',
  loginBackgroundUrl: null,
  loginMessage: 'Bienvenue',
  languages: ['fr'],
  defaultLocale: 'fr',
  contact: { phone: null, email: null, address: null, website: null },
};

function stubFetch(impl: () => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => impl()),
  );
}

function renderApp() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.head.querySelectorAll('link[rel="icon"]').forEach((l) => l.remove());
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
});
afterEach(() => vi.unstubAllGlobals());

describe('portal branding', () => {
  it('fetches the public branding at boot and applies CSS variables, logo, title and favicon', async () => {
    stubFetch(() => new Response(JSON.stringify(PUBLIC), { status: 200 }));
    const { container } = renderApp();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--hm-primary')).toBe('#0b5d3b'),
    );
    expect(document.documentElement.style.getPropertyValue('--hm-secondary')).toBe('#102a43');
    expect(document.documentElement.style.getPropertyValue('--hm-on-primary')).toBe('#ffffff');
    expect(fetch).toHaveBeenCalledWith('/api/v1/portal/branding', expect.anything());
    await waitFor(() =>
      expect(container.querySelector('img.brand-logo')).toHaveAttribute('src', PUBLIC.logoUrl),
    );
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', PUBLIC.faviconUrl);
    await waitFor(() => expect(document.title).toContain('Hôtel Aurore'));
    expect((await screen.findAllByText('Hôtel Aurore')).length).toBeGreaterThan(0);
  });

  it('falls back to the default theme when the API fails', async () => {
    stubFetch(() => new Response('{}', { status: 500 }));
    renderApp();
    expect(await screen.findAllByText(defaultPortalBranding.name)).not.toHaveLength(0);
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--hm-primary')).toBe(
        defaultPortalBranding.primaryColor,
      ),
    );
  });

  it('ignores malformed colors and keeps a readable text color', () => {
    const b = toPortalBranding({
      ...PUBLIC,
      colors: { ...PUBLIC.colors, primary: 'javascript:x' },
    });
    expect(b.primaryColor).toBe(defaultPortalBranding.primaryColor);
    const dark = toPortalBranding({ ...PUBLIC, colors: { ...PUBLIC.colors, primary: '#ffee00' } });
    expect(contrastRatio(dark.primaryColor, dark.onPrimaryColor)).toBeGreaterThanOrEqual(4.5);
  });
});
