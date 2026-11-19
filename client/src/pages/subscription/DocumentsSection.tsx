import { FilePdfOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { money, useFormatDate } from '../../billing/common';
import type { TenantInvoice, TenantReceipt } from '../../billing/common';

const INVOICE_COLORS: Record<string, string> = {
  DRAFT: 'default',
  ISSUED: 'blue',
  PARTIALLY_PAID: 'gold',
  PAID: 'green',
  OVERDUE: 'red',
  VOID: 'default',
};

/** Fetches the signed URL of a PDF and opens it in a new tab. */
function usePdf(path: (id: string) => string) {
  return useMutation({
    mutationFn: (id: string) => apiClient.get<{ url: string | null }>(path(id)),
    onSuccess: (r) => {
      if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer');
    },
  });
}

/** TN-30: invoices and receipts of the tenant, with PDF download. */
export function DocumentsSection() {
  const { t } = useTranslation('subscription');
  const fmt = useFormatDate();
  const invoices = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () =>
      apiClient.get<{ items: TenantInvoice[]; total: number }>('/billing/invoices?limit=50'),
  });
  const receipts = useQuery({
    queryKey: ['billing', 'receipts'],
    queryFn: () => apiClient.get<{ items: TenantReceipt[] }>('/billing/receipts'),
  });
  const invoicePdf = usePdf((id) => `/billing/invoices/${id}/pdf`);
  const receiptPdf = usePdf((id) => `/billing/receipts/${id}/pdf`);

  return (
    <>
      <Card title={t('invoices.title')}>
        {invoicePdf.isError ? (
          <Alert type="error" showIcon message={t('pdfError')} style={{ marginBottom: 8 }} />
        ) : null}
        <Table<TenantInvoice>
          size="small"
          rowKey="id"
          loading={invoices.isPending}
          dataSource={invoices.data?.items ?? []}
          locale={{ emptyText: t('invoices.empty') }}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('invoices.number'), dataIndex: 'number' },
            {
              title: t('invoices.issueDate'),
              dataIndex: 'issueDate',
              render: (d: string) => fmt.day(d),
            },
            {
              title: t('invoices.dueDate'),
              dataIndex: 'dueDate',
              render: (d: string) => fmt.day(d),
            },
            {
              title: t('invoices.total'),
              dataIndex: 'total',
              align: 'right',
              render: (v: number, r) => money(v, r.currency),
            },
            {
              title: t('invoices.balance'),
              dataIndex: 'balance',
              align: 'right',
              render: (v: number, r) => money(v, r.currency),
            },
            {
              title: t('invoices.status'),
              render: (_: unknown, r) => {
                const s = r.overdue && r.status !== 'PAID' ? 'OVERDUE' : r.status;
                return <Tag color={INVOICE_COLORS[s]}>{t(`invoiceStatus.${s}`)}</Tag>;
              },
            },
            {
              title: t('invoices.pdf'),
              render: (_: unknown, r) => (
                <Button
                  size="small"
                  icon={<FilePdfOutlined />}
                  loading={invoicePdf.isPending && invoicePdf.variables === r.id}
                  aria-label={`${t('invoices.pdf')} ${r.number}`}
                  onClick={() => invoicePdf.mutate(r.id)}
                >
                  {t('invoices.pdf')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title={t('receipts.title')}>
        {receiptPdf.isError ? (
          <Alert type="error" showIcon message={t('pdfError')} style={{ marginBottom: 8 }} />
        ) : null}
        <Table<TenantReceipt>
          size="small"
          rowKey="id"
          loading={receipts.isPending}
          dataSource={receipts.data?.items ?? []}
          locale={{ emptyText: t('receipts.empty') }}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('receipts.number'), dataIndex: 'receiptNumber' },
            { title: t('receipts.paidAt'), dataIndex: 'paidAt', render: (d: string) => fmt.day(d) },
            {
              title: t('receipts.amount'),
              dataIndex: 'amount',
              align: 'right',
              render: (v: number, r) => money(v, r.currency),
            },
            {
              title: t('receipts.method'),
              dataIndex: 'method',
              render: (m: string) => t(`method.${m}`, { defaultValue: m }),
            },
            {
              title: t('receipts.reference'),
              dataIndex: 'reference',
              render: (r: string | null) => r ?? '—',
            },
            {
              title: t('receipts.pdf'),
              render: (_: unknown, r) => (
                <Button
                  size="small"
                  icon={<FilePdfOutlined />}
                  loading={receiptPdf.isPending && receiptPdf.variables === r.id}
                  aria-label={`${t('receipts.pdf')} ${r.receiptNumber}`}
                  onClick={() => receiptPdf.mutate(r.id)}
                >
                  {t('receipts.pdf')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
