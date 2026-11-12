import { Button } from 'antd';
import { useTranslation } from 'react-i18next';

import { EmptyState, PageHeader, canAccess, useSessionStore } from '@hm/ui';

import type { ModuleDef } from '../modules';

/** Generic placeholder shown until each module's own work package replaces it. */
export function ModulePage({ module }: { module: ModuleDef }) {
  const { t } = useTranslation();
  const features = useSessionStore((s) => s.features);
  const permissions = useSessionStore((s) => s.permissions);
  const allowed = canAccess(module, { features, permissions });

  return (
    <>
      <PageHeader title={t(module.labelKey)} />
      {allowed ? (
        <EmptyState title={t('placeholder.title')} description={t('placeholder.description')} />
      ) : (
        <EmptyState
          title={t('forbidden.title')}
          description={t('forbidden.description')}
          action={<Button href="/dashboard">{t('nav:dashboard')}</Button>}
        />
      )}
    </>
  );
}
