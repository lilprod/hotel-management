import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AppShell,
  EmptyState,
  HmThemeProvider,
  LanguageSwitch,
  PageHeader,
  StatusTag,
  ThemeToggle,
  contrastRatio,
  filterModules,
  defaultBranding,
  readableTextColor,
  useUiStore,
  STORAGE_KEY,
} from './index';

beforeEach(() => {
  window.localStorage.clear();
  useUiStore.setState({ mode: 'light', language: 'fr' });
});

describe('useUiStore', () => {
  it('persists mode and language in localStorage', () => {
    useUiStore.getState().setMode('dark');
    useUiStore.getState().setLanguage('en');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      mode: 'dark',
      language: 'en',
    });
  });

  it('keeps working when localStorage throws', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      useUiStore.getState().toggleMode();
      expect(useUiStore.getState().mode).toBe('dark');
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('branding helpers', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio(defaultBranding.primaryColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(readableTextColor('#ffffff')).toBe('#000000');
  });
});

describe('components', () => {
  it('HmThemeProvider sets theme and language on the document', () => {
    useUiStore.setState({ mode: 'dark', language: 'en' });
    render(
      <HmThemeProvider>
        <p>content</p>
      </HmThemeProvider>,
    );
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.lang).toBe('en');
  });

  it('StatusTag shows a text label and unknown statuses fall back', () => {
    render(
      <>
        <StatusTag status="checked_in" />
        <StatusTag status="weird" label="Custom" />
      </>,
    );
    expect(screen.getByText('Checked in')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('PageHeader and EmptyState render', () => {
    render(
      <>
        <PageHeader title="Title" subtitle="Sub" actions={<button>Go</button>} />
        <EmptyState title="Nothing" description="Add one" />
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });

  it('LanguageSwitch and ThemeToggle update the store', async () => {
    const user = userEvent.setup();
    render(
      <>
        <LanguageSwitch />
        <ThemeToggle label="theme" />
      </>,
    );
    await user.click(screen.getByText('EN'));
    expect(useUiStore.getState().language).toBe('en');
    await user.click(screen.getByRole('button', { name: 'theme' }));
    expect(useUiStore.getState().mode).toBe('dark');
  });

  it('AppShell renders items and navigates', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <HmThemeProvider>
        <AppShell
          brandName="Brand"
          items={[
            { key: 'a', label: 'Alpha', path: '/a' },
            { key: 'b', label: 'Beta', path: '/b' },
          ]}
          onNavigate={(p) => calls.push(p)}
          header={<span>top</span>}
          navLabel="Main"
          skipLabel="Skip"
        >
          <p>body</p>
        </AppShell>
      </HmThemeProvider>,
    );
    await user.click(screen.getByText('Beta'));
    expect(calls).toEqual(['/b']);
    expect(screen.getByText('Skip')).toHaveAttribute('href', '#main-content');
  });
});

describe('filterModules', () => {
  const mods = [
    { key: 'a', labelKey: 'a', path: '/a' },
    { key: 'b', labelKey: 'b', path: '/b', requiredFeature: 'spa' },
    { key: 'c', labelKey: 'c', path: '/c', requiredPermission: 'c.read' },
  ];

  it('keeps modules matching features and permissions', () => {
    const keys = (features: string[], permissions: string[]) =>
      filterModules(mods, { features, permissions }).map((m) => m.key);
    expect(keys([], [])).toEqual(['a']);
    expect(keys(['spa'], [])).toEqual(['a', 'b']);
    expect(keys(['spa'], ['c.read'])).toEqual(['a', 'b', 'c']);
    expect(keys(['*'], ['*'])).toEqual(['a', 'b', 'c']);
  });
});
