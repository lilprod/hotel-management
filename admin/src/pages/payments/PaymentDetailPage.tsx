import { FilePdfOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Skeleton, Table, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient, useMeStore } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { money, useAbilities, useFormatDate } from '../../billing/common';
import type { Payment, PaymentAllocation } from '../../billing/common';
import {
  InvoiceStatusTag,
  PaymentStatusTag,
  ReasonModal,
  openUrl,
  useMethodLabel,
} from '../../billing/ui';

/** A payment may not be validated by the user who recorded it (`recordedBy` = `platform:<id>`). */
export function recordedByMe(p: Pick<Payment, 'recordedBy'>, userId: string | undefined): boolean {
  return Boolean(userId) && p.recordedBy === `platform:${userId}`;
}

/** SA-33/34/35: payment detail, receipt PDF, second validation and reversal (contre-passation). */
export function PaymentDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation('pay');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const methodLabel = useMethodLabel();
  const fmt = useFormatDate();
  const can = useAbilities();
  const me = useMeStore((s) => s.me);
  const qc = useQueryClient();
  const [reversing, setReversing] = useState(false);

  const q = useQuery({
    queryKey: ['payment', id],
    queryFn: () => apiClient.get<Payment>(`/payments/${id}`),
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['payment', id] }),
      qc.invalidateQueries({ queryKey: ['payments'] }),
      qc.invalidateQueries({ queryKey: ['billing-dashboard'] }),
    ]);
  };
  const validate = useMutation({
    mutationFn: () => apiClient.post(`/payments/${id}/validate`),
    onSuccess: refresh,
  });
  const receipt = useMutation({
    mutationFn: () => apiClient.get<{ url: string | null }>(`/payments/${id}/receipt`),
    onSuccess: (r) => openUrl(r.url),
  });

  const p = q.data;
  const sameUser = p ? recordedByMe(p, me?.id) : false;

  return (
    <>
      <PageHeader
        title={p?.receiptNumber ?? t('detail')}
        subtitle={p ? `${p.tenant.name}` : undefined}
        breadcrumb={[{ title: <Link to="/payments">{t('title')}</Link> }, { title: t('detail') }]}
        actions={
          p ? (
            <>
              {p.receiptNumber ? (
                <Button
                  icon={<FilePdfOutlined />}
                  loading={receipt.isPending}
                  onClick={() => receipt.mutate()}
                >
                  {t('receiptPdf')}
                </Button>
              ) : null}
              {can.finance && p.status === 'PENDING_VALIDATION' ? (
                <Tooltip title={sameUser ? t('sameUserHint') : undefined}>
                  <span>
                    <Button
                      type="primary"
                      disabled={sameUser}
                      loading={validate.isPending}
                      onClick={() => validate.mutate()}
                    >
                      {t('validate')}
                    </Button>
                  </span>
                </Tooltip>
              ) : null}
              {can.finance && p.status !== 'REVERSED' ? (
                <Button danger onClick={() => setReversing(true)}>
                  {t('reverse')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {q.isError ? <Alert type="error" showIcon message={message(q.error)} /> : null}
      {validate.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={message(validate.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {receipt.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={message(receipt.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {q.isPending ? <Skeleton active /> : null}
      {p ? (
        <>
          {sameUser && p.status === 'PENDING_VALIDATION' && can.finance ? (
            <Alert type="info" showIcon message={t('sameUserHint')} style={{ marginBottom: 12 }} />
          ) : null}
          <Card size="small">
            <Descriptions column={{ xs: 1, md: 2 }} size="small">
              <Descriptions.Item label={tb('status')}>
                <PaymentStatusTag status={p.status} />
              </Descriptions.Item>
              <Descriptions.Item label={tb('tenant')}>
                <Link to={`/tenants/${p.tenant.id}`}>{p.tenant.name}</Link>
              </Descriptions.Item>
              <Descriptions.Item label={tb('amount')}>
                {money(p.amount, p.currency)}
              </Descriptions.Item>
              <Descriptions.Item label={tb('method.label')}>
                {methodLabel(p.method)}
              </Descriptions.Item>
              <Descriptions.Item label={t('paidAt')}>{fmt.day(p.paidAt)}</Descriptions.Item>
              <Descriptions.Item label={t('reference')}>{p.reference ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={t('credit')}>
                {money(p.credit, p.currency)}
              </Descriptions.Item>
              <Descriptions.Item label={t('attachment')}>
                {p.attachmentFileId ? t('attachmentYes') : t('attachmentNo')}
              </Descriptions.Item>
              <Descriptions.Item label={t('recordedBy')}>{p.recordedBy ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={t('validatedBy')}>
                {p.validatedBy ? `${p.validatedBy} (${fmt.dateTime(p.validatedAt)})` : '—'}
              </Descriptions.Item>
              {p.declarationId ? (
                <Descriptions.Item label={t('fromDeclaration')}>
                  <Link to="/payment-declarations">{t('seeDeclarations')}</Link>
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label={t('note')} span={2}>
                {p.note ?? '—'}
              </Descriptions.Item>
              {p.status === 'REVERSED' ? (
                <Descriptions.Item label={t('reversalReason')} span={2}>
                  {p.reversalReason} ({fmt.dateTime(p.reversedAt)})
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </Card>
          <Card size="small" title={t('allocations')} style={{ marginTop: 16 }}>
            <Table<PaymentAllocation>
              size="small"
              rowKey="invoiceId"
              pagination={false}
              dataSource={p.allocations}
              locale={{ emptyText: t('noAllocation') }}
              columns={[
                {
                  title: t('invoice'),
                  render: (_: unknown, a) => (
                    <Link to={`/invoices/${a.invoiceId}`}>{a.invoiceNumber}</Link>
                  ),
                },
                {
                  title: tb('status'),
                  render: (_: unknown, a) => (
                    <InvoiceStatusTag
                      status={a.invoiceStatus as Parameters<typeof InvoiceStatusTag>[0]['status']}
                    />
                  ),
                },
                {
                  title: tb('amount'),
                  dataIndex: 'amount',
                  align: 'right',
                  render: (a: number) => money(a, p.currency),
                },
              ]}
            />
          </Card>
        </>
      ) : null}
      {reversing && p ? (
        <ReasonModal
          danger
          title={t('reverseTitle')}
          description={t('reverseWarning')}
          okText={t('reverse')}
          onSubmit={(reason) => apiClient.post(`/payments/${id}/reverse`, { reason }).then(refresh)}
          onClose={() => setReversing(false)}
        />
      ) : null}
    </>
  );
}
