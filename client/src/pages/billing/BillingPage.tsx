import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { PropertySelect, useActiveProperty } from '../../reservations/property';
import { TENDER_METHODS, bkKeys, get, openDocument, post, qs } from './api';
import type { Aging, CompanyAccount, Invoice, Page, Statement } from './api';
import { CreditNoteDialog, useEmailInvoice } from './InvoiceDialogs';
import { money, toMinor } from './model';

const { Text } = Typography;
const { RangePicker } = DatePicker;

/** Invoices list (OP-95): filters, PDF, e-mail, credit notes; a credit note shows as AV-… against its invoice. */
export function InvoicesList() {
  const { t } = useTranslation('billing');
  const { can } = useCan();
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const { propertyId } = useActiveProperty();
  const [kind, setKind] = useState<'INVOICE' | 'CREDIT_NOTE' | undefined>(undefined);
  const [range, setRange] = useState<[string, string] | null>(null);
  const [search, setSearch] = useState('');
  const [credit, setCredit] = useState<Invoice | null>(null);
  const email = useEmailInvoice();

  const q = useQuery({
    queryKey: bkKeys.invoices({ propertyId, kind, range }),
    queryFn: () =>
      get<Page<Invoice>>(
        `/invoices${qs({ propertyId, kind, from: range?.[0], to: range?.[1], limit: 100 })}`,
      ),
    enabled: !!propertyId,
  });
  const items = (q.data?.items ?? []).filter(
    (i) =>
      !search ||
      i.number.toLowerCase().includes(search.toLowerCase()) ||
      i.customer.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          aria-label={t('invoices.search')}
          placeholder={t('invoices.search')}
          onSearch={setSearch}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder={t('invoices.kind')}
          aria-label={t('invoices.kind')}
          style={{ width: 170 }}
          onChange={(v) => setKind(v)}
          options={[
            { value: 'INVOICE', label: t('invoices.kinds.INVOICE') },
            { value: 'CREDIT_NOTE', label: t('invoices.kinds.CREDIT_NOTE') },
          ]}
        />
        <RangePicker
          onChange={(d) =>
            setRange(d?.[0] && d[1] ? [d[0].format('YYYY-MM-DD'), d[1].format('YYYY-MM-DD')] : null)
          }
        />
      </Space>
      <Table<Invoice>
        size="small"
        rowKey="id"
        loading={q.isLoading}
        dataSource={items}
        locale={{ emptyText: t('invoices.empty') }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        columns={[
          { title: t('invoices.number'), dataIndex: 'number' },
          {
            title: t('invoices.kind'),
            dataIndex: 'kind',
            render: (k: string) => (
              <Tag color={k === 'INVOICE' ? 'blue' : 'orange'}>{t(`invoices.kinds.${k}`)}</Tag>
            ),
          },
          { title: t('invoices.date'), dataIndex: 'issueDate' },
          {
            title: t('invoices.customer'),
            key: 'c',
            render: (_: unknown, i) => (
              <span>
                {i.customer.name}
                {i.customer.taxId ? <Text type="secondary"> (NIF {i.customer.taxId})</Text> : null}
              </span>
            ),
          },
          {
            title: t('invoices.total'),
            dataIndex: 'total',
            align: 'right',
            render: (v: number, i) => money(v, i.currency),
          },
          {
            title: t('invoices.status'),
            dataIndex: 'status',
            render: (s: string) => <Tag>{t(`invoices.statuses.${s}`, { defaultValue: s })}</Tag>,
          },
          {
            title: '',
            key: 'a',
            render: (_: unknown, i) => (
              <Space size={4} wrap>
                <Link to={`/folios/${i.folioId}`}>{t('invoices.folio')}</Link>
                <Button
                  size="small"
                  onClick={() =>
                    void openDocument(`/invoices/${i.id}/pdf`).catch(
                      (e) => void message.error(toMessage(e)),
                    )
                  }
                >
                  PDF
                </Button>
                {can('invoices.issue') ? (
                  <Button
                    size="small"
                    onClick={() =>
                      email.mutate(
                        { id: i.id },
                        {
                          onSuccess: (r) =>
                            void message.success(t('invoice.emailSent', { to: r.to ?? '' })),
                          onError: (e) => void message.error(toMessage(e)),
                        },
                      )
                    }
                  >
                    {t('invoice.sendEmail')}
                  </Button>
                ) : null}
                {can('invoices.credit_note') && i.kind === 'INVOICE' ? (
                  <Button size="small" danger onClick={() => setCredit(i)}>
                    {t('invoices.creditNote')}
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      <CreditNoteDialog invoice={credit} onClose={() => setCredit(null)} />
    </>
  );
}

/** City ledger (OP-96, feature `city_ledger`): company accounts, statement, settlement and aging. */
export function CityLedgerTab() {
  const { t } = useTranslation('billing');
  const { can } = useCan();
  const { propertyId } = useActiveProperty();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const accounts = useQuery({
    queryKey: bkKeys.accounts(propertyId),
    queryFn: () => get<{ items: CompanyAccount[] }>(`/city-ledger/accounts${qs({ propertyId })}`),
    enabled: !!propertyId,
  });
  const aging = useQuery({
    queryKey: bkKeys.aging(propertyId),
    queryFn: () => get<Aging>(`/city-ledger/aging${qs({ propertyId })}`),
    enabled: !!propertyId,
  });
  const chosen = accounts.data?.items.find((a) => a.companyId === companyId) ?? null;
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Table<CompanyAccount>
        size="small"
        rowKey="companyId"
        loading={accounts.isLoading}
        dataSource={accounts.data?.items ?? []}
        locale={{ emptyText: t('cl.empty') }}
        pagination={false}
        columns={[
          { title: t('cl.company'), dataIndex: 'companyName' },
          { title: 'NIF', dataIndex: 'taxId' },
          {
            title: t('cl.charges'),
            dataIndex: 'charges',
            align: 'right',
            render: (v: number, a) => money(v, a.currency),
          },
          {
            title: t('cl.settlements'),
            dataIndex: 'settlements',
            align: 'right',
            render: (v: number, a) => money(v, a.currency),
          },
          {
            title: t('cl.balance'),
            dataIndex: 'balance',
            align: 'right',
            render: (v: number, a) => (
              <Text type={v > 0 ? 'danger' : undefined}>{money(v, a.currency)}</Text>
            ),
          },
          {
            title: t('cl.creditLimit'),
            dataIndex: 'creditLimit',
            align: 'right',
            render: (v: number | null, a) => (v === null ? '-' : money(v, a.currency)),
          },
          {
            title: '',
            key: 'a',
            render: (_: unknown, a) => (
              <Button size="small" onClick={() => setCompanyId(a.companyId)}>
                {t('cl.open')}
              </Button>
            ),
          },
        ]}
      />
      <Card size="small" title={t('cl.aging')}>
        <Table
          size="small"
          rowKey="companyId"
          pagination={false}
          dataSource={aging.data?.items ?? []}
          columns={[
            { title: t('cl.company'), dataIndex: 'companyName' },
            ...(['current', 'd31_60', 'd61_90', 'over90'] as const).map((b) => ({
              title: t(`cl.buckets.${b}`),
              key: b,
              align: 'right' as const,
              render: (_: unknown, r: Aging['items'][number]) => money(r.buckets[b]),
            })),
            {
              title: t('cl.total'),
              dataIndex: 'total',
              align: 'right',
              render: (v: number) => <Text strong>{money(v)}</Text>,
            },
          ]}
        />
      </Card>
      <Drawer
        open={!!chosen}
        onClose={() => setCompanyId(null)}
        width={720}
        destroyOnHidden
        title={chosen?.companyName}
      >
        {chosen ? <Account account={chosen} canManage={can('city_ledger.manage')} /> : null}
      </Drawer>
    </Space>
  );
}

function Account({ account, canManage }: { account: CompanyAccount; canManage: boolean }) {
  const { t } = useTranslation('billing');
  const toMessage = useApiError();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const [method, setMethod] = useState<(typeof TENDER_METHODS)[number]>('BANK_TRANSFER');
  const [amount, setAmount] = useState<number | null>(account.balance > 0 ? account.balance : null);
  const [reference, setReference] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const st = useQuery({
    queryKey: bkKeys.statement(account.companyId, account.propertyId),
    queryFn: () =>
      get<Statement>(
        `/city-ledger/accounts/${account.companyId}/statement${qs({ propertyId: account.propertyId })}`,
      ),
  });
  const settle = useMutation({
    mutationFn: () =>
      post(
        `/city-ledger/accounts/${account.companyId}/settlements`,
        {
          propertyId: account.propertyId,
          method,
          amount: toMinor(amount, account.currency),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
        { 'Idempotency-Key': crypto.randomUUID() },
      ),
    onSuccess: () => {
      setFailure(null);
      setReference('');
      void qc.invalidateQueries({ queryKey: ['billing', 'cl'] });
      void message.success(t('cl.settled'));
    },
    onError: (e) => setFailure(toMessage(e)),
  });
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Descriptions size="small" column={2}>
        <Descriptions.Item label="NIF">{account.taxId ?? '-'}</Descriptions.Item>
        <Descriptions.Item label={t('cl.balance')}>
          {money(account.balance, account.currency)}
        </Descriptions.Item>
      </Descriptions>
      <Table
        size="small"
        rowKey={(e) => `${e.date}-${e.folioNumber}-${e.label}-${e.balance}`}
        loading={st.isLoading}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={st.data?.entries ?? []}
        columns={[
          { title: t('folio.date'), dataIndex: 'date' },
          { title: t('folio.label'), dataIndex: 'label' },
          {
            title: t('cl.debit'),
            dataIndex: 'debit',
            align: 'right',
            render: (v: number) => (v ? money(v, account.currency) : ''),
          },
          {
            title: t('cl.credit'),
            dataIndex: 'credit',
            align: 'right',
            render: (v: number) => (v ? money(v, account.currency) : ''),
          },
          {
            title: t('cl.balance'),
            dataIndex: 'balance',
            align: 'right',
            render: (v: number) => money(v, account.currency),
          },
        ]}
      />
      {canManage ? (
        <Card size="small" title={t('cl.settlement')}>
          <Form layout="vertical" onFinish={() => settle.mutate()}>
            <Form.Item label={t('pay.method')}>
              <Radio.Group
                optionType="button"
                value={method}
                onChange={(e) => setMethod(e.target.value as (typeof TENDER_METHODS)[number])}
                options={TENDER_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
              />
            </Form.Item>
            <Form.Item label={t('pay.amount', { currency: account.currency })}>
              <InputNumber
                aria-label={t('pay.amount', { currency: account.currency })}
                min={1}
                style={{ width: '100%' }}
                value={amount}
                onChange={setAmount}
              />
            </Form.Item>
            <Form.Item label={t('pay.reference')}>
              <Input
                aria-label={t('pay.reference')}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
              />
            </Form.Item>
            {failure ? (
              <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />
            ) : null}
            <Button type="primary" htmlType="submit" loading={settle.isPending} disabled={!amount}>
              {t('cl.settle')}
            </Button>
          </Form>
        </Card>
      ) : null}
    </Space>
  );
}

/** Billing hub: Invoices and (feature-gated) City ledger. */
export function BillingPage() {
  const { t } = useTranslation('billing');
  const { has, can } = useCan();
  const [params, setParams] = useSearchParams();
  const tabs = [
    ...(can('invoices.read')
      ? [{ key: 'invoices', label: t('tabs.invoices'), children: <InvoicesList /> }]
      : []),
    ...(has('city_ledger') && can('city_ledger.read')
      ? [{ key: 'city-ledger', label: t('tabs.cityLedger'), children: <CityLedgerTab /> }]
      : []),
  ];
  return (
    <>
      <PageHeader title={t('title')} actions={<PropertySelect />} />
      <Tabs
        items={tabs}
        activeKey={params.get('tab') ?? tabs[0]?.key}
        onChange={(k) => setParams({ tab: k })}
        destroyInactiveTabPane
      />
    </>
  );
}
