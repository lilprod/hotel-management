import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import { EmptyState, PageHeader, useSessionStore } from '@hm/ui';

import { useCan } from '../auth/useCan';
import { ChecklistCard } from './Checklist';
import { useOnboarding } from './api';
import { markRedirected, wasRedirected } from './redirect';

/**
 * Dashboard: the owner lands on the wizard right after the first login (once per session, while
 * it is in progress); afterwards the "Finish your setup" card stays until the wizard is done.
 */
export function DashboardPage() {
  const { t } = useTranslation(['onboarding', 'nav']);
  const { can } = useCan();
  const manage = can('settings.manage');
  const user = useSessionStore((s) => s.user);
  const onboarding = useOnboarding(manage);
  const data = onboarding.data;
  const goWizard = !!data && data.status === 'in_progress' && !wasRedirected();

  useEffect(() => {
    if (goWizard) markRedirected();
  }, [goWizard]);

  if (goWizard) return <Navigate to="/onboarding" replace />;
  return (
    <>
      <PageHeader
        title={t('nav:dashboard')}
        subtitle={user?.name ? t('onboarding:dashboard.welcome', { name: user.name }) : undefined}
      />
      {manage && data && data.status !== 'completed' ? <ChecklistCard view={data} /> : null}
      <EmptyState
        title={t('onboarding:dashboard.title')}
        description={t('onboarding:dashboard.placeholder')}
      />
    </>
  );
}
