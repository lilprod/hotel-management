import { useQuery } from '@tanstack/react-query';
import { Alert, Checkbox, Flex, Input, Select, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { INVOICE_STATUSES, money, qs, useFormatDate } from '../../billing/common';
import type { Invoice, Paged } from '../../billing/common';
import { TenantSelect, useDebounced, usePaging } from '../../billing/hooks';
import { InvoiceStatusTag } from '../../billing/ui';

/** SA-28: platform invoices (`PLT-YYYY-NNNNNN`), filterable. `ISSUED` is displayed "Ouverte". */
export function InvoicesPage() {
  const { t } = useTranslation('inv');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const fmt = useFormatDate();
  const paging = usePaging();
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);

  const filters = { tenantId, status, from, to, q, overdue: overdue || undefined };
  const list = useQuery({
    queryKey: ['invoices', filters, paging.limit, paging.offset],
    queryFn: () =>
      apiClient.get<Paged<Invoice>>(
        `/invoices${qs({ ...filters, limit: paging.limit, offset: paging.offset })}`,
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
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Flex gap={12} wrap style={{ marginBottom: 16 }} role="search" aria-label={t('filters')}>
        <div style={{ width: 260 }}>
          <TenantSelect allowClear value={tenantId} onChange={(v) => onFilter(setTenantId)(v)} />
        </div>
        <Select
          allowClear
          placeholder={tb('status')}
          aria-label={tb('status')}
          style={{ width: 200 }}
          value={status}
          onChange={onFilter(setStatus)}
          options={INVOICE_STATUSES.map((s) => ({ value: s, label: tb(`invoiceStatus.${s}`) }))}
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
        <Checkbox checked={overdue} onChange={(e) => onFilter(setOverdue)(e.target.checked)}>
          {t('onlyOverdue')}
        </Checkbox>
      </Flex>
      {list.isError ? (
        <Alert type="error" showIcon message={message(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<Invoice>
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={paging.table(list.data?.total ?? 0)}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('number'),
            dataIndex: 'number',
            render: (n: string, i) => <Link to={`/invoices/${i.id}`}>{n}</Link>,
          },
          {
            title: tb('tenant'),
            render: (_: unknown, i) => <Link to={`/tenants/${i.tenant.id}`}>{i.tenant.name}</Link>,
          },
          { title: t('issueDate'), dataIndex: 'issueDate', render: (d: string) => fmt.day(d) },
          { title: t('dueDate'), dataIndex: 'dueDate', render: (d: string) => fmt.day(d) },
          {
            title: t('total'),
            dataIndex: 'total',
            align: 'right',
            render: (a: number, i) => money(a, i.currency),
          },
          {
            title: t('balance'),
            dataIndex: 'balance',
            align: 'right',
            render: (a: number, i) => money(a, i.currency),
          },
          {
            title: tb('status'),
            dataIndex: 'status',
            render: (_: unknown, i) => (
              <InvoiceStatusTag
                status={i.overdue && i.status !== 'OVERDUE' ? 'OVERDUE' : i.status}
              />
            ),
          },
        ]}
      />
    </>
  );
}
