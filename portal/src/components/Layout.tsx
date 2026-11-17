import { Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';

import '@fontsource/fraunces/latin-300.css';
import '@fontsource/fraunces/latin-300-italic.css';
import '@fontsource/fraunces/latin-400.css';
import '@fontsource-variable/figtree/wght.css';

import { useTenantBranding } from '../branding';
import { useReducedMotion } from '../lib/useReducedMotion';
import { portalRoutes } from '../routes';
import '../styles/base.css';
import '../styles/chrome.css';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function Layout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const reducedMotion = useReducedMotion();
  const branding = useTenantBranding();

  // On client-side navigation: update the title, return to the top and move focus to <main>.
  useEffect(() => {
    const route = portalRoutes.find((r) => r.path === pathname);
    document.title = route ? `${t(route.labelKey)} | ${branding.name}` : branding.name;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, t, branding.name]);

  return (
    <div className={reducedMotion ? 'site motion-reduce' : 'site'}>
      <a className="skip-link" href="#main">
        {t('skipToContent')}
      </a>
      <SiteHeader />
      <main id="main" ref={mainRef} tabIndex={-1} className="main">
        <Suspense
          fallback={
            <p role="status" className="route-loading">
              {t('loading')}
            </p>
          }
        >
          <div key={pathname} className="page">
            <Outlet />
          </div>
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
