import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';

import { useUiStore } from '@hm/ui/core';

import { useTenantBranding } from '../branding';
import { useFocusTrap } from '../lib/useFocusTrap';
import { useScrolled } from '../lib/useScrolled';
import { portalRoutes } from '../routes';
import { Icon } from './Icon';

/** Width from which the inline desktop navigation replaces the drawer (matches the CSS). */
const DESKTOP_QUERY = '(min-width: 68.75rem)';

// "Réserver" is the call to action: shown last, styled as a button.
const navRoutes = [
  ...portalRoutes.filter((r) => r.key !== 'booking'),
  ...portalRoutes.filter((r) => r.key === 'booking'),
];

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

export function SiteHeader() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const branding = useTenantBranding();
  const scrolled = useScrolled();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close on navigation.
  useEffect(() => setOpen(false), [pathname]);

  // Close when the viewport grows to the desktop layout.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Lock page scroll behind the drawer.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useFocusTrap(navRef, { active: open, onEscape: () => setOpen(false), returnFocusTo: toggleRef });

  const phone = branding.contact?.phone;

  return (
    <>
      <header className={`site-header${scrolled ? ' is-scrolled' : ''}${open ? ' is-open' : ''}`}>
        <div className="container bar">
          <NavLink to="/" className="brand">
            {branding.logoUrl ? (
              <img className="brand-logo" src={branding.logoUrl} alt="" height={36} />
            ) : (
              <span className="brand-mark" aria-hidden="true">
                {branding.name.charAt(0)}
              </span>
            )}
            <span className="brand-name">{branding.name}</span>
          </NavLink>

          <nav
            id="primary-nav"
            ref={navRef}
            aria-label={t('nav:main')}
            className={open ? 'nav open' : 'nav'}
          >
            <button type="button" className="nav-close" onClick={() => setOpen(false)}>
              <Icon name="close" />
              <span className="visually-hidden">{t('closeMenu')}</span>
            </button>
            <ul>
              {navRoutes.map((r, i) => (
                <li key={r.key} style={{ '--i': i } as CSSProperties}>
                  <NavLink
                    to={r.path}
                    end={r.path === '/'}
                    className={r.key === 'booking' ? 'nav-cta' : undefined}
                  >
                    {t(r.labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
            {phone ? (
              <p className="nav-phone">
                <span>{t('site:header.contactTitle')}</span>
                <a href={`tel:${phone.replace(/\s+/g, '')}`}>{phone}</a>
              </p>
            ) : null}
          </nav>

          <div className="bar-actions">
            <LanguageSwitch />
            <button
              ref={toggleRef}
              type="button"
              className="menu-toggle"
              aria-expanded={open}
              aria-controls="primary-nav"
              aria-label={open ? t('closeMenu') : t('openMenu')}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="burger" aria-hidden="true">
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </header>
      {/* Click-away layer behind the open drawer (keyboard users have Escape and the close button). */}
      <div
        className={open ? 'nav-backdrop open' : 'nav-backdrop'}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
    </>
  );
}

/** Small helper reused by the footer: same destinations as the header, minus the CTA. */
export function footerLinks() {
  return navRoutes.filter((r) => r.key !== 'booking' && r.key !== 'home');
}
