import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { contrastRatio, readableTextColor, useUiStore } from '@hm/ui/core';

import { App } from './App';
import { tenantBranding } from './branding';
import i18n from './i18n';
import { portalRoutes } from './routes';
import { countNights } from './pages/BookingSearchPage';

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
});

describe('portal', () => {
  it('renders accessible landmarks, skip link and navigation', async () => {
    renderApp();
    expect(screen.getByRole('link', { name: 'Aller au contenu principal' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('link')).toHaveLength(portalRoutes.length);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bienvenue' })).toBeInTheDocument();
  });

  it('switches language and updates the document language', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'English' }));
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByText('Accommodations')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
  });

  it('lazy-loads section pages', async () => {
    renderApp('/spa');
    expect(await screen.findByRole('heading', { level: 1, name: 'Spa' })).toBeInTheDocument();
  });

  it('validates the booking search form with labelled fields', async () => {
    const user = userEvent.setup();
    renderApp('/booking');
    await screen.findByRole('heading', { level: 1, name: 'Rechercher un séjour' });
    await user.type(screen.getByLabelText('Arrivée'), '2030-05-10');
    await user.type(screen.getByLabelText('Départ'), '2030-05-08');
    await user.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(await screen.findByText("Le départ doit être après l'arrivée.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Départ'));
    await user.type(screen.getByLabelText('Départ'), '2030-05-13');
    await user.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(await screen.findByRole('status')).toHaveTextContent('3 nuits');
  });

  it('counts nights with arrival included and departure excluded', () => {
    expect(countNights('2030-05-10', '2030-05-11')).toBe(1);
    expect(countNights('2030-02-27', '2030-03-02')).toBe(3);
  });

  it('keeps WCAG AA contrast for the placeholder branding', () => {
    const onPrimary = readableTextColor(tenantBranding.primaryColor);
    expect(contrastRatio(tenantBranding.primaryColor, onPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tenantBranding.primaryColor, '#faf7f2')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', tenantBranding.secondaryColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#4b5563', '#faf7f2')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#b00020', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
