import { DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Flex, Input, Select, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import {
  METHODS,
  PAYMENT_STATUSES,
  money,
  qs,
  useAbilities,
  useFormatDate,
} from '../../billing/common';
import type { Paged, Payment } from '../../billing/common';
import { TenantSelect, useDebounced, usePaging } from '../../billing/hooks';
import { PaymentStatusTag, downloadFile, useMethodLabel } from '../../billing/ui';

/** SA-31/33: payments list with filters and CSV export. */
export function PaymentsPage() {
  const { t } = useTranslation('pay');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const methodLabel = useMethodLabel();
  const can = useAbilities();
  const fmt = useFormatDate();
  const navigate = useNavigate();
  const paging = usePaging();
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [method, setMethod] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = { tenantId, method, status, from, to, q };
  const list = useQuery({
    queryKey: ['payments', filters, paging.limit, paging.offset],
    queryFn: () =>
      apiClient.get<Paged<Payment>>(
        `/payments${qs({ ...filters, limit: paging.limit, offset: paging.offset })}`,
      ),
  });
  const onFilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      paging.reset();
    };

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <Button
              icon={<DownloadOutlined />}
              onClick={() =>
                void downloadFile(`/payments/export.csv${qs(filters)}`).catch((e: unknown) =>
                  setExportError(message(e)),
                )
              }
            >
              {tb('exportCsv')}
            </Button>
            {can.finance ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/payments/new')}
              >
                {t('new')}
              </Button>
            ) : null}
          </>
        }
      />
      <Flex gap={12} wrap style={{ marginBottom: 16 }} role="search" aria-label={t('filters')}>
        <div style={{ width: 260 }}>
          <TenantSelect allowClear value={tenantId} onChange={(v) => onFilter(setTenantId)(v)} />
        </div>
        <Select
          allowClear
          placeholder={tb('method.label')}
          aria-label={tb('method.label')}
          style={{ width: 180 }}
          value={method}
          onChange={onFilter(setMethod)}
          options={METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
        />
        <Select
          allowClear
          placeholder={tb('status')}
          aria-label={tb('status')}
          style={{ width: 180 }}
          value={status}
          onChange={onFilter(setStatus)}
          options={PAYMENT_STATUSES.map((s) => ({ value: s, label: tb(`paymentStatus.${s}`) }))}
        />
        <Input
          type="date"
          aria-label={t('from')}
          style={{ width: 160 }}
          value={from}
          onChange={(e) => onFilter(setFrom)(e.target.value)}
        />
        <Input
          type="date"
          aria-label={t('to')}
          style={{ width: 160 }}
          value={to}
          onChange={(e) => onFilter(setTo)(e.target.value)}
        />
        <Input.Search
          allowClear
          placeholder={t('searchPlaceholder')}
          aria-label={tb('search')}
          style={{ width: 240 }}
          value={search}
          onChange={(e) => onFilter(setSearch)(e.target.value)}
        />
      </Flex>
      {list.isError ? (
        <Alert type="error" showIcon message={message(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {exportError ? (
        <Alert type="error" showIcon message={exportError} closable style={{ marginBottom: 12 }} />
      ) : null}
      <Table<Payment>
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={paging.table(list.data?.total ?? 0)}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: tb('date'), dataIndex: 'paidAt', render: (d: string) => fmt.day(d) },
          {
            title: t('receipt'),
            dataIndex: 'receiptNumber',
            render: (n: string | null, p) => (
              <Link to={`/payments/${p.id}`}>{n ?? t('noReceipt')}</Link>
            ),
          },
          {
            title: tb('tenant'),
            render: (_: unknown, p) => <Link to={`/tenants/${p.tenant.id}`}>{p.tenant.name}</Link>,
          },
          {
            title: tb('amount'),
            dataIndex: 'amount',
            align: 'right',
            render: (a: number, p) => money(a, p.currency),
          },
          { title: tb('method.label'), dataIndex: 'method', render: (m: string) => methodLabel(m) },
          { title: t('reference'), dataIndex: 'reference', render: (r: string | null) => r ?? '—' },
          {
            title: tb('status'),
            dataIndex: 'status',
            render: (s: Payment['status']) => <PaymentStatusTag status={s} />,
          },
        ]}
      />
    </>
  );
}
