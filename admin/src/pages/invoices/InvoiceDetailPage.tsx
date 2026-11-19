import { FilePdfOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Skeleton, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { money, useAbilities, useFormatDate } from '../../billing/common';
import type { Invoice, PayMethod, PaymentStatus } from '../../billing/common';
import {
  InvoiceStatusTag,
  PaymentStatusTag,
  ReasonModal,
  openUrl,
  useMethodLabel,
} from '../../billing/ui';

interface InvoiceLine {
  id: string;
  label: string;
  qty: number;
  unitAmount: number;
  amount: number;
}
interface InvoiceAllocation {
  paymentId: string;
  amount: number;
  counted: boolean;
  payment: {
    id: string;
    method: PayMethod;
    reference: string | null;
    status: PaymentStatus;
    receiptNumber: string | null;
  };
}
type InvoiceFull = Invoice & { lines: InvoiceLine[]; allocations: InvoiceAllocation[] };

/** SA-28/29: invoice detail with PDF and void (reason mandatory; an unpaid invoice only). */
export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation('inv');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const methodLabel = useMethodLabel();
  const fmt = useFormatDate();
  const can = useAbilities();
  const qc = useQueryClient();
  const [voiding, setVoiding] = useState(false);

  const q = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => apiClient.get<InvoiceFull>(`/invoices/${id}`),
  });
  const pdf = useMutation({
    mutationFn: () => apiClient.get<{ url: string | null }>(`/invoices/${id}/pdf`),
    onSuccess: (r) => openUrl(r.url),
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['invoice', id] }),
      qc.invalidateQueries({ queryKey: ['invoices'] }),
      qc.invalidateQueries({ queryKey: ['billing-dashboard'] }),
    ]);
  };
  const i = q.data;
  const canVoid =
    can.finance && !!i && (i.status === 'ISSUED' || i.status === 'OVERDUE') && i.amountPaid === 0;

  return (
    <>
      <PageHeader
        title={i?.number ?? t('detail')}
        subtitle={i?.tenant.name}
        breadcrumb={[{ title: <Link to="/invoices">{t('title')}</Link> }, { title: t('detail') }]}
        actions={
          i ? (
            <>
              <Button
                icon={<FilePdfOutlined />}
                loading={pdf.isPending}
                onClick={() => pdf.mutate()}
              >
                {t('pdf')}
              </Button>
              {canVoid ? (
                <Button danger onClick={() => setVoiding(true)}>
                  {t('void')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {q.isError ? <Alert type="error" showIcon message={message(q.error)} /> : null}
      {pdf.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={message(pdf.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {q.isPending ? <Skeleton active /> : null}
      {i ? (
        <>
          <Card size="small">
            <Descriptions column={{ xs: 1, md: 2 }} size="small">
              <Descriptions.Item label={tb('status')}>
                <InvoiceStatusTag
                  status={i.overdue && i.status !== 'OVERDUE' ? 'OVERDUE' : i.status}
                />
              </Descriptions.Item>
              <Descriptions.Item label={tb('tenant')}>
                <Link to={`/tenants/${i.tenant.id}`}>{i.tenant.name}</Link>
              </Descriptions.Item>
              <Descriptions.Item label={t('issueDate')}>{fmt.day(i.issueDate)}</Descriptions.Item>
              <Descriptions.Item label={t('dueDate')}>{fmt.day(i.dueDate)}</Descriptions.Item>
              <Descriptions.Item label={t('period')}>
                {i.periodStart ? `${fmt.day(i.periodStart)} → ${fmt.day(i.periodEnd)}` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('subtotal')}>
                {money(i.subtotal, i.currency)}
              </Descriptions.Item>
              <Descriptions.Item label={t('tax')}>{money(i.tax, i.currency)}</Descriptions.Item>
              <Descriptions.Item label={t('total')}>
                <strong>{money(i.total, i.currency)}</strong>
              </Descriptions.Item>
              <Descriptions.Item label={t('paid')}>
                {money(i.amountPaid, i.currency)}
              </Descriptions.Item>
              <Descriptions.Item label={t('balance')}>
                <strong>{money(i.balance, i.currency)}</strong>
              </Descriptions.Item>
            </Descriptions>
          </Card>
          <Card size="small" title={t('lines')} style={{ marginTop: 16 }}>
            <Table<InvoiceLine>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={i.lines}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: t('label'), dataIndex: 'label' },
                { title: t('qty'), dataIndex: 'qty', align: 'right' },
                {
                  title: t('unitAmount'),
                  dataIndex: 'unitAmount',
                  align: 'right',
                  render: (a: number) => money(a, i.currency),
                },
                {
                  title: tb('amount'),
                  dataIndex: 'amount',
                  align: 'right',
                  render: (a: number) => money(a, i.currency),
                },
              ]}
            />
          </Card>
          <Card size="small" title={t('payments')} style={{ marginTop: 16 }}>
            <Table<InvoiceAllocation>
              size="small"
              rowKey="paymentId"
              pagination={false}
              dataSource={i.allocations}
              locale={{ emptyText: t('noPayment') }}
              scroll={{ x: 'max-content' }}
              columns={[
                {
                  title: t('receipt'),
                  render: (_: unknown, a) => (
                    <Link to={`/payments/${a.paymentId}`}>{a.payment.receiptNumber ?? '—'}</Link>
                  ),
                },
                {
                  title: tb('method.label'),
                  render: (_: unknown, a) => methodLabel(a.payment.method),
                },
                { title: t('reference'), render: (_: unknown, a) => a.payment.reference ?? '—' },
                {
                  title: tb('status'),
                  render: (_: unknown, a) => <PaymentStatusTag status={a.payment.status} />,
                },
                {
                  title: tb('amount'),
                  dataIndex: 'amount',
                  align: 'right',
                  render: (a: number) => money(a, i.currency),
                },
              ]}
            />
          </Card>
        </>
      ) : null}
      {voiding ? (
        <ReasonModal
          danger
          title={t('voidTitle')}
          description={t('voidWarning')}
          okText={t('void')}
          onSubmit={(reason) => apiClient.post(`/invoices/${id}/void`, { reason }).then(refresh)}
          onClose={() => setVoiding(false)}
        />
      ) : null}
    </>
  );
}
