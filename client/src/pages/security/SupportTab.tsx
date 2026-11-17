import { useQuery } from '@tanstack/react-query';
import { Alert, Table } from 'antd';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import type { ImpersonationEvent } from './api';
import { fmtDate } from './SessionsPanel';

/** Support ("act as") sessions opened on this hotel by the platform team. */
export function SupportTab() {
  const { t, i18n } = useTranslation('security');
  const message = useApiError();
  const q = useQuery({
    queryKey: ['iam-impersonations'],
    queryFn: () => apiClient.get<{ items: ImpersonationEvent[] }>('/iam/impersonations'),
  });
  return (
    <>
      {q.isError ? (
        <Alert type="error" showIcon message={message(q.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<ImpersonationEvent>
        rowKey="id"
        size="middle"
        loading={q.isPending}
        dataSource={q.data?.items ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('support.empty') }}
        columns={[
          {
            title: t('audit.at'),
            dataIndex: 'at',
            render: (v: string) => fmtDate(v, i18n.language),
          },
          {
            title: t('audit.action'),
            dataIndex: 'action',
            render: (v: string) => <code>{v}</code>,
          },
          {
            title: t('support.agent'),
            key: 'agent',
            render: (_: unknown, r) => r.details?.platformUser?.name ?? r.platformUserId ?? '—',
          },
          {
            title: t('support.reason'),
            key: 'reason',
            render: (_: unknown, r) => r.details?.reason ?? '—',
          },
        ]}
      />
    </>
  );
}
