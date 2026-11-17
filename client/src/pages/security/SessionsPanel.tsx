import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Popconfirm, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';

export interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
  impersonation: boolean;
}

export const fmtDate = (iso: string | null | undefined, lang: string): string =>
  iso
    ? new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : '—';

/** My active sessions (`/auth/sessions`) with per-session revocation. */
export function SessionsPanel() {
  const { t, i18n } = useTranslation('security');
  const message = useApiError();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => apiClient.get<{ items: SessionRow[] }>('/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-sessions'] }),
  });

  return (
    <>
      {list.isError ? (
        <Alert type="error" showIcon message={message(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {revoke.isError ? (
        <Alert type="error" showIcon message={message(revoke.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<SessionRow>
        rowKey="id"
        size="middle"
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('sessions.empty') }}
        columns={[
          {
            title: t('sessions.device'),
            dataIndex: 'userAgent',
            render: (ua: string | null, r) => (
              <>
                {ua ?? '—'} {r.current ? <Tag color="green">{t('sessions.current')}</Tag> : null}
                {r.impersonation ? <Tag color="orange">{t('sessions.support')}</Tag> : null}
              </>
            ),
          },
          { title: t('sessions.ip'), dataIndex: 'ip', render: (v: string | null) => v ?? '—' },
          {
            title: t('sessions.started'),
            dataIndex: 'createdAt',
            render: (v: string) => fmtDate(v, i18n.language),
          },
          {
            title: t('sessions.lastSeen'),
            dataIndex: 'lastSeenAt',
            render: (v: string | null) => fmtDate(v, i18n.language),
          },
          {
            title: t('sessions.actions'),
            key: 'actions',
            render: (_: unknown, r) => (
              <Popconfirm
                title={t('sessions.revokeConfirm')}
                okText={t('sessions.revoke')}
                cancelText={t('cancel')}
                disabled={r.current}
                onConfirm={() => revoke.mutate(r.id)}
              >
                <Button size="small" danger disabled={r.current}>
                  {t('sessions.revoke')}
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </>
  );
}
