import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Skeleton, Statistic, Table, Typography } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import {
  METHODS,
  SUB_STATUSES,
  addMonthsIso,
  money,
  qs,
  todayIso,
  useFormatDate,
} from '../../billing/common';
import type { Invoice, Paged, PayMethod, SubStatus } from '../../billing/common';
import { InvoiceStatusTag } from '../../billing/ui';

export interface DashboardData {
  asOf: string;
  revenue: { subscriptions: number; byCurrency: { currency: string; mrr: number; arr: number }[] };
  tenantsByStatus: Record<SubStatus, number>;
  trialConversions: {
    started: number;
    converted: number;
    lost: number;
    conversionRateBps: number | null;
  };
  collectionsThisMonth: { method: PayMethod; currency: string; amount: number }[];
  receivables: { total: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
}

export interface CollectionsReport {
  rows: { period: string; method: PayMethod; currency: string; amount: number; count: number }[];
  totalsByMethod: { method: PayMethod; currency: string; amount: number }[];
}

/** Distinct colors that stay readable in the light and dark themes; labels never rely on color alone. */
export const METHOD_COLORS: Record<PayMethod, string> = {
  MIXX: '#1677ff',
  MOOV_MONEY: '#fa8c16',
  CASH: '#52c41a',
  CARD: '#722ed1',
};
export const STATUS_COLORS: Record<SubStatus, string> = {
  TRIALING: '#13c2c2',
  ACTIVE: '#52c41a',
  PAST_DUE: '#fa8c16',
  SUSPENDED: '#f5222d',
  CANCELLED: '#8c8c8c',
};

/** 12-month stacked series (one row per month, one key per method) for the platform currency. */
export function stackCollections(rows: CollectionsReport['rows'], currency = 'XOF') {
  const months = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    if (r.currency !== currency) continue;
    const row = months.get(r.period) ?? { period: r.period };
    row[r.method] = ((row[r.method] as number | undefined) ?? 0) + r.amount;
    months.set(r.period, row);
  }
  return [...months.values()].sort((a, b) =>
    String(a['period']).localeCompare(String(b['period'])),
  );
}

function KpiCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Statistic title={title} value={value} />
      {hint ? <Typography.Text type="secondary">{hint}</Typography.Text> : null}
    </Card>
  );
}

function InvoiceList({
  title,
  empty,
  items,
  loading,
}: {
  title: string;
  empty: string;
  items: Invoice[];
  loading: boolean;
}) {
  const { t } = useTranslation('dash');
  const fmt = useFormatDate();
  return (
    <Card size="small" title={title} style={{ height: '100%' }}>
      <Table<Invoice>
        size="small"
        rowKey="id"
        loading={loading}
        pagination={false}
        dataSource={items}
        locale={{ emptyText: empty }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('invoice'),
            dataIndex: 'number',
            render: (n: string, i) => <Link to={`/invoices/${i.id}`}>{n}</Link>,
          },
          {
            title: t('tenant'),
            render: (_: unknown, i) => <Link to={`/tenants/${i.tenant.id}`}>{i.tenant.name}</Link>,
          },
          { title: t('dueDate'), dataIndex: 'dueDate', render: (d: string) => fmt.day(d) },
          {
            title: t('balance'),
            dataIndex: 'balance',
            align: 'right',
            render: (b: number, i) => money(b, i.currency),
          },
          {
            title: t('status'),
            dataIndex: 'status',
            render: (_: unknown, i) => (
              <InvoiceStatusTag status={i.overdue ? 'OVERDUE' : i.status} />
            ),
          },
        ]}
      />
    </Card>
  );
}

/** SA-01: platform dashboard (MRR/ARR, tenants by status, collections, trials, due and overdue invoices). */
export function DashboardPage() {
  const { t } = useTranslation('dash');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const today = todayIso();
  const from = addMonthsIso(today, -11);

  const dash = useQuery({
    queryKey: ['billing-dashboard'],
    queryFn: () => apiClient.get<DashboardData>('/billing/reports/dashboard'),
  });
  const series = useQuery({
    queryKey: ['billing-collections-12m', from, today],
    queryFn: () =>
      apiClient.get<CollectionsReport>(
        `/billing/reports/collections${qs({ from, to: today, groupBy: 'month' })}`,
      ),
  });
  const overdue = useQuery({
    queryKey: ['dashboard-overdue'],
    queryFn: () => apiClient.get<Paged<Invoice>>(`/invoices${qs({ overdue: true, limit: 200 })}`),
  });
  const open = useQuery({
    queryKey: ['dashboard-upcoming'],
    queryFn: () =>
      apiClient.get<Paged<Invoice>>(`/invoices${qs({ status: 'ISSUED', limit: 200 })}`),
  });

  const upcoming = useMemo(
    () =>
      (open.data?.items ?? [])
        .filter((i) => i.dueDate >= today && i.balance > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 8),
    [open.data, today],
  );
  const late = useMemo(
    () =>
      [...(overdue.data?.items ?? [])]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 8),
    [overdue.data],
  );
  const stacked = useMemo(() => stackCollections(series.data?.rows ?? []), [series.data]);
  const donut = useMemo(
    () =>
      SUB_STATUSES.map((s) => ({
        status: s,
        name: tb(`subStatus.${s}`),
        value: dash.data?.tenantsByStatus[s] ?? 0,
      })).filter((d) => d.value > 0),
    [dash.data, tb],
  );

  const d = dash.data;
  const mrr = d?.revenue.byCurrency[0];
  const monthByMethod = (m: PayMethod) =>
    d?.collectionsThisMonth
      .filter((c) => c.method === m && c.currency === 'XOF')
      .reduce((s, c) => s + c.amount, 0) ?? 0;
  const rate = d?.trialConversions.conversionRateBps;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {dash.isError ? (
        <Alert type="error" showIcon message={message(dash.error)} style={{ marginBottom: 16 }} />
      ) : null}
      {dash.isPending ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : d ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title={t('mrr')}
                value={money(mrr?.mrr ?? 0, mrr?.currency ?? 'XOF')}
                hint={t('subscriptions', { count: d.revenue.subscriptions })}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard title={t('arr')} value={money(mrr?.arr ?? 0, mrr?.currency ?? 'XOF')} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title={t('trialConversion')}
                value={
                  rate == null
                    ? '—'
                    : `${(rate / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`
                }
                hint={t('trialDetail', {
                  converted: d.trialConversions.converted,
                  lost: d.trialConversions.lost,
                  started: d.trialConversions.started,
                })}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title={t('receivables')}
                value={money(d.receivables.total)}
                hint={t('receivablesHint')}
              />
            </Col>
          </Row>

          <Card size="small" title={t('statusCards')} style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]}>
              {SUB_STATUSES.map((s) => (
                <Col key={s} xs={12} sm={8} lg={4} xl={{ flex: '1 1 0' }}>
                  <Statistic title={tb(`subStatus.${s}`)} value={d.tenantsByStatus[s] ?? 0} />
                </Col>
              ))}
            </Row>
          </Card>

          <Card size="small" title={t('monthCollections')} style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]}>
              {METHODS.map((m) => (
                <Col key={m} xs={12} lg={6}>
                  <Statistic title={tb(`method.${m}`)} value={money(monthByMethod(m))} />
                </Col>
              ))}
            </Row>
          </Card>
        </>
      ) : null}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={14}>
          <Card size="small" title={t('chartCollections')} loading={series.isPending}>
            {stacked.length === 0 ? (
              <Typography.Text type="secondary">{t('noData')}</Typography.Text>
            ) : (
              <div
                style={{ width: '100%', height: 300 }}
                role="img"
                aria-label={t('chartCollections')}
              >
                <ResponsiveContainer>
                  <BarChart data={stacked}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" />
                    <YAxis width={80} tickFormatter={(v: number) => v.toLocaleString('fr-FR')} />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Legend />
                    {METHODS.map((m) => (
                      <Bar
                        key={m}
                        dataKey={m}
                        name={tb(`method.${m}`)}
                        stackId="c"
                        fill={METHOD_COLORS[m]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title={t('chartStatus')} loading={dash.isPending}>
            {donut.length === 0 ? (
              <Typography.Text type="secondary">{t('noData')}</Typography.Text>
            ) : (
              <div style={{ width: '100%', height: 300 }} role="img" aria-label={t('chartStatus')}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={donut}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={100}
                      label
                    >
                      {donut.map((e) => (
                        <Cell key={e.status} fill={STATUS_COLORS[e.status]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <InvoiceList
            title={t('upcoming')}
            empty={t('noUpcoming')}
            items={upcoming}
            loading={open.isPending}
          />
        </Col>
        <Col xs={24} xl={12}>
          <InvoiceList
            title={t('overdue')}
            empty={t('noOverdue')}
            items={late}
            loading={overdue.isPending}
          />
        </Col>
      </Row>
    </>
  );
}
