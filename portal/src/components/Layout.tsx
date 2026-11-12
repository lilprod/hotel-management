import { Suspense, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { readableTextColor, useUiStore } from '@hm/ui/core';

import { tenantBranding } from '../branding';
import { portalRoutes } from '../routes';

function LanguageSwitch() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const setLanguage = useUiStore((s) => s.setLanguage);
  return (
    <div className="lang" role="group" aria-label={t('language')}>
      <button
        type="button"
        lang="fr"
        aria-pressed={language === 'fr'}
        aria-label={t('french')}
        onClick={() => setLanguage('fr')}
      >
        FR
      </button>
      <button
        type="button"
        lang="en"
        aria-pressed={language === 'en'}
        aria-label={t('english')}
        onClick={() => setLanguage('en')}
      >
        EN
      </button>
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  const style = {
    '--hm-primary': tenantBranding.primaryColor,
    '--hm-on-primary': readableTextColor(tenantBranding.primaryColor),
    '--hm-secondary': tenantBranding.secondaryColor,
  } as CSSProperties;

  // On client-side navigation: close the mobile menu, update the title and move focus to <main>.
  useEffect(() => {
    setMenuOpen(false);
    const route = portalRoutes.find((r) => r.path === pathname);
    document.title = route ? `${t(route.labelKey)} | ${tenantBranding.name}` : tenantBranding.name;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname, t]);

  return (
    <div className="site" style={style}>
      <a className="skip-link" href="#main">
        {t('skipToContent')}
      </a>
      <header className="site-header">
        <div className="container bar">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              {tenantBranding.name.charAt(0)}
            </span>
            <span>{tenantBranding.name}</span>
          </NavLink>
          <LanguageSwitch />
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? t('closeMenu') : t('openMenu')}
          </button>
          <nav
            id="primary-nav"
            aria-label={t('nav:main')}
            className={menuOpen ? 'nav open' : 'nav'}
          >
            <ul>
              {portalRoutes.map((r) => (
                <li key={r.key}>
                  <NavLink to={r.path} end={r.path === '/'}>
                    {t(r.labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="container main">
        <Suspense fallback={<p role="status">{t('loading')}</p>}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="site-footer">
        <div className="container">
          © {new Date().getFullYear()} {tenantBranding.name}. {t('footer')}
        </div>
      </footer>
    </div>
  );
}
