import { useTranslation } from 'react-i18next';

import { EmptyState, PageHeader } from '@hm/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('notFound')} />
      <EmptyState title={t('notFound')} />
    </>
  );
}
