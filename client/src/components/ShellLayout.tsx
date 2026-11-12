import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { AppShell, defaultBranding, filterModules, useSessionStore } from '@hm/ui';

import { modules } from '../modules';
import { HeaderBar } from './HeaderBar';

export function ShellLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const features = useSessionStore((s) => s.features);
  const permissions = useSessionStore((s) => s.permissions);

  const visible = filterModules(modules, { features, permissions });
  const current = [...modules]
    .sort((a, b) => b.path.length - a.path.length)
    .find((m) => pathname === m.path || pathname.startsWith(`${m.path}/`));

  return (
    <AppShell
      brandName={defaultBranding.name}
      logoUrl={defaultBranding.logoUrl}
      items={visible.map((m) => ({
        key: m.key,
        label: t(m.labelKey),
        icon: m.icon,
        path: m.path,
      }))}
      selectedKey={current?.key}
      onNavigate={(path) => navigate(path)}
      header={<HeaderBar />}
      navLabel={t('nav:main')}
      skipLabel={t('skipToContent')}
    >
      <Outlet />
    </AppShell>
  );
}
