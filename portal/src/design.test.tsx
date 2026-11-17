import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contrastRatio, useUiStore } from '@hm/ui/core';

import { App } from './App';
import { applyBranding, buildPalette, defaultPortalBranding, toPortalBranding } from './branding';
import type { PublicBranding } from './branding';
import { Photo } from './components/Photo';
import { buildBookingUrl } from './components/SearchBar';
import { Testimonials } from './components/Testimonials';
import i18n from './i18n';
import { resolvePhoto } from './media/photos';

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
  useUiStore.setState({ mode: 'light', language: 'fr' });
  await i18n.changeLanguage('fr');
});

describe('mobile menu', () => {
  it('opens, traps focus, closes with Escape and restores focus to the toggle', async () => {
    const user = userEvent.setup();
    renderApp();
    const toggle = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'primary-nav');

    await user.click(toggle);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(nav).toHaveClass('open');
    expect(
      screen.getByRole('button', { name: 'Fermer le menu', expanded: true }),
    ).toBeInTheDocument();
    const close = within(nav).getByRole('button', { name: 'Fermer le menu' });
    expect(close).toHaveFocus();

    // Tab cycles inside the drawer: from the last link back to the close button.
    const links = within(nav).getAllByRole('link');
    (links[links.length - 1] as HTMLElement).focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(links[links.length - 1]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(nav).not.toHaveClass('open');
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(toggle).toHaveFocus();
  });

  it('closes after following a link', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    await user.click(within(nav).getByRole('link', { name: 'Spa' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Spa' })).toBeInTheDocument();
    expect(nav).not.toHaveClass('open');
  });
});

describe('home search bar', () => {
  it('builds the booking URL with query params', () => {
    expect(
      buildBookingUrl({ checkIn: '2030-05-10', checkOut: '2030-05-13', adults: 3, children: 1 }),
    ).toBe('/booking?checkIn=2030-05-10&checkOut=2030-05-13&adults=3&children=1');
  });

  it('navigates to /booking and prefills the search page', async () => {
    const user = userEvent.setup();
    renderApp();
    const form = await screen.findByRole('form', { name: 'Vérifier les disponibilités' });
    fireEvent.change(within(form).getByLabelText('Arrivée'), { target: { value: '2030-05-10' } });
    fireEvent.change(within(form).getByLabelText('Départ'), { target: { value: '2030-05-13' } });
    await user.selectOptions(within(form).getByLabelText('Adultes'), '3');
    await user.selectOptions(within(form).getByLabelText('Enfants'), '1');
    await user.click(within(form).getByRole('button', { name: 'Rechercher' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rechercher un séjour' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Arrivée')).toHaveValue('2030-05-10');
    expect(screen.getByLabelText('Départ')).toHaveValue('2030-05-13');
    expect(screen.getByLabelText('Adultes')).toHaveValue(3);
    expect(screen.getByLabelText('Enfants')).toHaveValue(1);
    expect(screen.getByRole('status')).toHaveTextContent('3 nuits');
  });

  it('refuses a departure that is not after the arrival', async () => {
    const user = userEvent.setup();
    renderApp();
    const form = await screen.findByRole('form', { name: 'Vérifier les disponibilités' });
    fireEvent.change(within(form).getByLabelText('Arrivée'), { target: { value: '2030-05-10' } });
    fireEvent.change(within(form).getByLabelText('Départ'), { target: { value: '2030-05-10' } });
    await user.click(within(form).getByRole('button', { name: 'Rechercher' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Le départ doit être après l'arrivée.",
    );
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Rechercher un séjour' }),
    ).not.toBeInTheDocument();
  });
});

describe('photos', () => {
  it('prefers the hotel photo over the demo photo', () => {
    const own = resolvePhoto('https://files.test/suite.jpg', 'suite');
    expect(own.src).toBe('https://files.test/suite.jpg');
    expect(own.isDemo).toBe(false);
    expect(own.srcSet).toBeUndefined();

    const demo = resolvePhoto(null, 'suite');
    expect(demo.isDemo).toBe(true);
    expect(demo.src).toContain('/demo/suite-1280.webp');
    expect(demo.srcSet).toContain('suite-640.webp 640w');
  });

  it('renders the uploaded photo when present, the demo otherwise, and a fallback on error', () => {
    const { rerender } = render(
      <Photo uploadedUrl="https://files.test/room.jpg" demo="suite" alt="Suite" sizes="100vw" />,
    );
    const img = screen.getByRole('img', { name: 'Suite' });
    expect(img).toHaveAttribute('src', 'https://files.test/room.jpg');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
    expect(img).toHaveAttribute('loading', 'lazy');

    rerender(<Photo demo="suite" alt="Suite" sizes="100vw" />);
    const demo = screen.getByRole('img', { name: 'Suite' });
    expect(demo.getAttribute('src')).toContain('/demo/suite-');
    expect(demo).toHaveAttribute('srcset');

    fireEvent.error(demo);
    const fallback = screen.getByRole('img', { name: 'Suite' });
    expect(fallback.tagName).toBe('DIV');
    expect(fallback).toHaveClass('photo-fallback');
  });

  it('uses the hero image uploaded in the branding on the home page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'Hôtel Aurore',
              colors: { primary: '#0f766e', secondary: '#f59e0b', onPrimary: '#ffffff' },
              logoUrl: null,
              loginBackgroundUrl: 'https://files.test/hero.jpg',
              languages: ['fr', 'en'],
              defaultLocale: 'fr',
              contact: { phone: '+22822000001', email: 'contact@example.invalid' },
            }),
            { status: 200 },
          ),
      ),
    );
    const { container } = renderApp();
    await vi.waitFor(() =>
      expect(container.querySelector('.hero-media img')).toHaveAttribute(
        'src',
        'https://files.test/hero.jpg',
      ),
    );
    expect(await screen.findAllByText('contact@example.invalid')).not.toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe('reduced motion', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('adds the motion-reduce class and stops the carousel pause control', () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    const { container } = renderApp();
    expect(container.querySelector('.site')).toHaveClass('motion-reduce');
    expect(
      screen.queryByRole('button', { name: 'Mettre le défilement en pause' }),
    ).not.toBeInTheDocument();
  });

  it('does not add the class by default', () => {
    const { container } = renderApp();
    expect(container.querySelector('.site')).not.toHaveClass('motion-reduce');
  });
});

describe('testimonials carousel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('auto-advances, and pauses on hover', () => {
    render(<Testimonials />);
    const label = () =>
      screen.getByRole('group', { name: /Témoignage \d sur 3/ }).getAttribute('aria-label');
    expect(label()).toBe('Témoignage 1 sur 3');
    act(() => void vi.advanceTimersByTime(7100));
    expect(label()).toBe('Témoignage 2 sur 3');

    const region = screen.getByRole('region', { name: 'Témoignages de clients' });
    fireEvent.mouseEnter(region);
    act(() => void vi.advanceTimersByTime(30000));
    expect(label()).toBe('Témoignage 2 sur 3');
    fireEvent.mouseLeave(region);
    act(() => void vi.advanceTimersByTime(7100));
    expect(label()).toBe('Témoignage 3 sur 3');
  });

  it('pauses on focus and with the pause button', () => {
    render(<Testimonials />);
    const region = screen.getByRole('region', { name: 'Témoignages de clients' });
    fireEvent.focus(within(region).getByRole('button', { name: 'Témoignage précédent' }));
    act(() => void vi.advanceTimersByTime(30000));
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Témoignage 1 sur 3');
    fireEvent.blur(within(region).getByRole('button', { name: 'Témoignage précédent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mettre le défilement en pause' }));
    act(() => void vi.advanceTimersByTime(30000));
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Témoignage 1 sur 3');
  });
});

describe('gallery lightbox', () => {
  it('opens from a thumbnail, navigates with arrows and closes with Escape', async () => {
    const user = userEvent.setup();
    renderApp('/spa');
    await screen.findByRole('heading', { level: 1, name: 'Spa' });
    const open = (
      await screen.findAllByRole('button', { name: /Agrandir la photo/ })
    )[0] as HTMLElement;
    await user.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Galerie photo' });
    expect(within(dialog).getByText('Photo 1 sur 6')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByText('Photo 2 sur 6')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
});

describe('tenant branding', () => {
  const PUBLIC: PublicBranding = {
    name: 'Hôtel 2 Février',
    colors: { primary: '#0F766E', secondary: '#F59E0B', onPrimary: '#ffffff' },
    logoUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    loginBackgroundUrl: null,
    loginMessage: null,
    languages: ['fr', 'en'],
    defaultLocale: 'fr',
    contact: { phone: null, email: null, address: null, website: null },
  };

  it('writes the tenant colors and contrast-safe derivatives to CSS variables', () => {
    applyBranding(toPortalBranding(PUBLIC));
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--hm-primary')).toBe('#0F766E');
    expect(style.getPropertyValue('--hm-secondary')).toBe('#F59E0B');
    expect(style.getPropertyValue('--hm-on-secondary')).not.toBe('');
    const deep = style.getPropertyValue('--hm-deep');
    expect(contrastRatio('#ffffff', deep)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(style.getPropertyValue('--hm-primary-glow'), deep)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('keeps text accents readable whatever the tenant color', () => {
    for (const primary of ['#ffee00', '#7a5a14', '#0f766e', '#111111', '#ff69b4']) {
      const p = buildPalette(primary, '#f59e0b');
      expect(contrastRatio(p.primaryInk, '#f9f8f5')).toBeGreaterThanOrEqual(4.4);
      expect(contrastRatio(p.primaryGlow, p.deep)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#ffffff', p.deep)).toBeGreaterThanOrEqual(7);
    }
  });

  it('falls back to the default theme tokens', () => {
    expect(defaultPortalBranding.onSecondaryColor).toMatch(/^#/);
  });
});
