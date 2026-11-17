import { Result, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';

import { evaluateGuard, useSessionStore } from '@hm/ui';
import type { GuardOptions } from '@hm/ui';

export function ForbiddenResult() {
  const { t } = useTranslation();
  return <Result status="403" title={t('forbidden.title')} subTitle={t('forbidden.description')} />;
}

/**
 * Route guard: unauthenticated → /login (remembers the target), pending password change →
 * /change-password, pending legal acceptance → /legal, then permission / feature checks.
 * Hiding is never the only control: the API enforces the same rules.
 */
export function Guard({ children, ...options }: GuardOptions & { children: ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const features = useSessionStore((s) => s.features);
  const permissions = useSessionStore((s) => s.permissions);
  const mustChangePassword = useSessionStore((s) => s.mustChangePassword);
  const legalBlocked = useSessionStore((s) => s.legalBlocked);
  const impersonation = useSessionStore((s) => s.impersonation);
  const location = useLocation();

  const result = evaluateGuard(
    { status, user, features, permissions, mustChangePassword, legalBlocked, impersonation },
    options,
  );
  if (result.type === 'loading') return <Spin fullscreen size="large" tip="…" />;
  if (result.type === 'redirect') {
    const from = result.to === '/login' ? { from: location.pathname + location.search } : undefined;
    return <Navigate to={result.to} replace state={from} />;
  }
  if (result.type === 'forbidden') return <ForbiddenResult />;
  return <>{children}</>;
}
