import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Drawer, Image, Segmented, Table, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { money, qs, useAbilities, useFormatDate } from '../../billing/common';
import type { Paged, PayMethod } from '../../billing/common';
import { usePaging } from '../../billing/hooks';
import { ReasonModal, useMethodLabel } from '../../billing/ui';

export interface Declaration {
  id: string;
  tenantId: string;
  tenantName: string;
  paymentId: string | null;
  amount: number;
  currency: string;
  method: PayMethod;
  reference: string | null;
  paidAt: string;
  attachmentFileId: string | null;
  note: string | null;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

const STATUS_COLORS = { SUBMITTED: 'gold', APPROVED: 'green', REJECTED: 'red' } as const;

interface Attachment {
  url: string | null;
  mime?: string;
}

/** Screenshot / PDF of the proof (signed URL). Degrades to a notice when no preview is available. */
function ProofPreview({ declaration }: { declaration: Declaration }) {
  const { t } = useTranslation('decl');
  const q = useQuery({
    queryKey: ['declaration-attachment', declaration.id],
    enabled: Boolean(declaration.attachmentFileId),
    retry: false,
    queryFn: () => apiClient.get<Attachment>(`/declarations/${declaration.id}/attachment`),
  });
  if (!declaration.attachmentFileId) return <p>{t('noProof')}</p>;
  if (q.isPending) return <p>{t('proofLoading')}</p>;
  if (q.isError || !q.data?.url)
    return <Alert type="info" showIcon message={t('proofUnavailable')} />;
  return q.data.mime === 'application/pdf' ? (
    <a href={q.data.url} target="_blank" rel="noopener noreferrer">
      {t('openProof')}
    </a>
  ) : (
    <Image src={q.data.url} alt={t('proofAlt')} style={{ maxHeight: 360, objectFit: 'contain' }} />
  );
}

function ReviewDrawer({
  declaration,
  tenantName,
  onClose,
}: {
  declaration: Declaration;
  tenantName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('decl');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const methodLabel = useMethodLabel();
  const fmt = useFormatDate();
  const can = useAbilities();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['declarations'] }),
      qc.invalidateQueries({ queryKey: ['payments'] }),
      qc.invalidateQueries({ queryKey: ['billing-dashboard'] }),
    ]);
  };
  const approve = useMutation({
    mutationFn: () =>
      apiClient.post<{ payment: { id: string } }>(`/declarations/${declaration.id}/approve`),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  const pending = declaration.status === 'SUBMITTED';
  return (
    <Drawer
      open
      width={520}
      title={t('review')}
      onClose={onClose}
      extra={
        can.finance && pending ? (
          <>
            <Button danger onClick={() => setRejecting(true)}>
              {t('reject')}
            </Button>{' '}
            <Button type="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
              {t('approve')}
            </Button>
          </>
        ) : null
      }
    >
      {approve.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={message(approve.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={tb('tenant')}>
          <Link to={`/tenants/${declaration.tenantId}`}>{tenantName}</Link>
        </Descriptions.Item>
        <Descriptions.Item label={tb('amount')}>
          {money(declaration.amount, declaration.currency)}
        </Descriptions.Item>
        <Descriptions.Item label={tb('method.label')}>
          {methodLabel(declaration.method)}
        </Descriptions.Item>
        <Descriptions.Item label={t('reference')}>{declaration.reference ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('paidAt')}>{fmt.day(declaration.paidAt)}</Descriptions.Item>
        <Descriptions.Item label={t('submittedAt')}>
          {fmt.dateTime(declaration.createdAt)}
        </Descriptions.Item>
        <Descriptions.Item label={t('note')}>{declaration.note ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={tb('status')}>
          {t(`status.${declaration.status}`)}
        </Descriptions.Item>
        {declaration.status === 'REJECTED' ? (
          <Descriptions.Item label={t('rejectReason')}>
            {declaration.rejectReason}
          </Descriptions.Item>
        ) : null}
        {declaration.paymentId ? (
          <Descriptions.Item label={t('payment')}>
            <Link to={`/payments/${declaration.paymentId}`}>{t('seePayment')}</Link>
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      <h3 style={{ marginTop: 16 }}>{t('proof')}</h3>
      <ProofPreview declaration={declaration} />
      {rejecting ? (
        <ReasonModal
          danger
          title={t('rejectTitle')}
          description={t('rejectHint')}
          okText={t('reject')}
          onSubmit={(reason) =>
            apiClient.post(`/declarations/${declaration.id}/reject`, { reason }).then(async () => {
              await refresh();
              onClose();
            })
          }
          onClose={() => setRejecting(false)}
        />
      ) : null}
    </Drawer>
  );
}

const FILTERS = ['SUBMITTED', 'APPROVED', 'REJECTED', 'ALL'] as const;

/** SA-36: queue of tenant payment declarations (preview of the proof, approve / reject with a reason). */
export function DeclarationsPage() {
  const { t } = useTranslation('decl');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const methodLabel = useMethodLabel();
  const fmt = useFormatDate();
  const paging = usePaging();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('SUBMITTED');
  const [selected, setSelected] = useState<Declaration | null>(null);
  const status = filter === 'ALL' ? undefined : filter;
  const list = useQuery({
    queryKey: ['declarations', status, paging.limit, paging.offset],
    queryFn: () =>
      apiClient.get<Paged<Declaration>>(
        `/declarations${qs({ status, limit: paging.limit, offset: paging.offset })}`,
      ),
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Segmented
        style={{ marginBottom: 16 }}
        value={filter}
        onChange={(v) => {
          setFilter(v);
          paging.reset();
        }}
        options={FILTERS.map((f) => ({ value: f, label: t(`filters.${f}`) }))}
      />
      {list.isError ? (
        <Alert type="error" showIcon message={message(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<Declaration>
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={paging.table(list.data?.total ?? 0)}
        locale={{ emptyText: t('empty') }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('submittedAt'),
            dataIndex: 'createdAt',
            render: (d: string) => fmt.dateTime(d),
          },
          {
            title: tb('tenant'),
            dataIndex: 'tenantName',
          },
          {
            title: tb('amount'),
            dataIndex: 'amount',
            align: 'right',
            render: (a: number, d) => money(a, d.currency),
          },
          { title: tb('method.label'), dataIndex: 'method', render: (m: string) => methodLabel(m) },
          { title: t('reference'), dataIndex: 'reference', render: (r: string | null) => r ?? '—' },
          {
            title: tb('status'),
            dataIndex: 'status',
            render: (s: Declaration['status']) => (
              <Tag color={STATUS_COLORS[s]}>{t(`status.${s}`)}</Tag>
            ),
          },
          {
            title: tb('actions'),
            key: 'a',
            render: (_: unknown, d) => (
              <Button size="small" onClick={() => setSelected(d)}>
                {t('review')}
              </Button>
            ),
          },
        ]}
      />
      {selected ? (
        <ReviewDrawer
          declaration={selected}
          tenantName={selected.tenantName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
