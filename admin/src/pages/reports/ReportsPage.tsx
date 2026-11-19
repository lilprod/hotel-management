import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Input,
  Row,
  Segmented,
  Statistic,
  Table,
  Tabs,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { addMonthsIso, money, qs, todayIso } from '../../billing/common';
import type { PayMethod, TenantRef } from '../../billing/common';
import { downloadFile, useMethodLabel } from '../../billing/ui';

type Buckets = {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
};
interface AgedRow extends Buckets {
  tenant: TenantRef;
  currency: string;
}
interface AgedReport {
  asOf: string;
  rows: AgedRow[];
  totals: Buckets;
}
interface CollectionsReport {
  from: string;
  to: string;
  rows: { period: string; method: PayMethod; currency: string; amount: number; count: number }[];
  totalsByMethod: { method: PayMethod; currency: string; amount: number }[];
}
interface TrialReport {
  started: number;
  converted: number;
  lost: number;
  conversionRateBps: number | null;
}

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'] as const;

function useExport() {
  const message = useApiError();
  const [error, setError] = useState<string | null>(null);
  const run = (path: string) => {
    setError(null);
    void downloadFile(path).catch((e: unknown) => setError(message(e)));
  };
  return { run, error };
}

function AgedTab() {
  const { t } = useTranslation('rep');
  const message = useApiError();
  const exporter = useExport();
  const [asOf, setAsOf] = useState(todayIso());
  const q = useQuery({
    queryKey: ['report-aged', asOf],
    queryFn: () => apiClient.get<AgedReport>(`/billing/reports/aged-receivables${qs({ asOf })}`),
  });
  const cell = (v: number, currency = 'XOF') => (v > 0 ? money(v, currency) : '—');
  return (
    <>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <label htmlFor="aged-asof">{t('asOf')}</label>
        <Input
          id="aged-asof"
          type="date"
          max={todayIso()}
          style={{ width: 170 }}
          value={asOf}
          onChange={(e) => e.target.value && setAsOf(e.target.value)}
        />
        <Button
          icon={<DownloadOutlined />}
          onClick={() => exporter.run(`/billing/reports/aged-receivables.csv${qs({ asOf })}`)}
        >
          {t('exportCsv')}
        </Button>
      </Flex>
      {q.isError ? (
        <Alert type="error" showIcon message={message(q.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {exporter.error ? (
        <Alert type="error" showIcon message={exporter.error} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<AgedRow>
        size="small"
        rowKey={(r) => `${r.tenant.id}|${r.currency}`}
        loading={q.isPending}
        dataSource={q.data?.rows ?? []}
        pagination={false}
        locale={{ emptyText: t('noReceivable') }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('tenant'),
            render: (_: unknown, r) => <Link to={`/tenants/${r.tenant.id}`}>{r.tenant.name}</Link>,
          },
          ...BUCKETS.map((b) => ({
            title: t(`buckets.${b}`),
            dataIndex: b,
            align: 'right' as const,
            render: (v: number, r: AgedRow) =>
              b === 'total' ? <strong>{cell(v, r.currency)}</strong> : cell(v, r.currency),
          })),
        ]}
        summary={() =>
          q.data && q.data.rows.length > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <strong>{t('totals')}</strong>
              </Table.Summary.Cell>
              {BUCKETS.map((b, n) => (
                <Table.Summary.Cell key={b} index={n + 1} align="right">
                  <strong>{cell(q.data!.totals[b])}</strong>
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          ) : null
        }
      />
    </>
  );
}

function CollectionsTab() {
  const { t } = useTranslation('rep');
  const message = useApiError();
  const methodLabel = useMethodLabel();
  const exporter = useExport();
  const today = todayIso();
  const [from, setFrom] = useState(addMonthsIso(today, -5));
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('month');
  const ready = from !== '' && to !== '' && from <= to;
  const params = { from, to, groupBy };
  const q = useQuery({
    queryKey: ['report-collections', from, to, groupBy],
    enabled: ready,
    queryFn: () => apiClient.get<CollectionsReport>(`/billing/reports/collections${qs(params)}`),
  });
  return (
    <>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <label htmlFor="col-from">{t('from')}</label>
        <Input
          id="col-from"
          type="date"
          style={{ width: 170 }}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label htmlFor="col-to">{t('to')}</label>
        <Input
          id="col-to"
          type="date"
          style={{ width: 170 }}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Segmented
          aria-label={t('groupBy')}
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: 'month', label: t('byMonth') },
            { value: 'day', label: t('byDay') },
          ]}
        />
        <Button
          icon={<DownloadOutlined />}
          disabled={!ready}
          onClick={() => exporter.run(`/billing/reports/collections.csv${qs(params)}`)}
        >
          {t('exportCsv')}
        </Button>
      </Flex>
      {!ready ? (
        <Alert type="warning" showIcon message={t('badRange')} style={{ marginBottom: 12 }} />
      ) : null}
      {q.isError ? (
        <Alert type="error" showIcon message={message(q.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {exporter.error ? (
        <Alert type="error" showIcon message={exporter.error} style={{ marginBottom: 12 }} />
      ) : null}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {(q.data?.totalsByMethod ?? []).map((x) => (
          <Col key={`${x.method}|${x.currency}`} xs={12} lg={6}>
            <Card size="small">
              <Statistic title={methodLabel(x.method)} value={money(x.amount, x.currency)} />
            </Card>
          </Col>
        ))}
      </Row>
      <Table<CollectionsReport['rows'][number]>
        size="small"
        rowKey={(r) => `${r.period}|${r.method}|${r.currency}`}
        loading={q.isPending && ready}
        dataSource={q.data?.rows ?? []}
        pagination={{ pageSize: 30, hideOnSinglePage: true }}
        locale={{ emptyText: t('noCollection') }}
        columns={[
          { title: t('period'), dataIndex: 'period' },
          { title: t('method'), dataIndex: 'method', render: (m: string) => methodLabel(m) },
          { title: t('count'), dataIndex: 'count', align: 'right' },
          {
            title: t('amount'),
            dataIndex: 'amount',
            align: 'right',
            render: (a: number, r) => money(a, r.currency),
          },
        ]}
      />
    </>
  );
}

function TrialsTab() {
  const { t } = useTranslation('rep');
  const message = useApiError();
  const today = todayIso();
  const [from, setFrom] = useState(addMonthsIso(today, -2));
  const [to, setTo] = useState(today);
  const ready = from !== '' && to !== '' && from <= to;
  const q = useQuery({
    queryKey: ['report-trials', from, to],
    enabled: ready,
    queryFn: () =>
      apiClient.get<TrialReport>(`/billing/reports/trial-conversions${qs({ from, to })}`),
  });
  const rate = q.data?.conversionRateBps;
  return (
    <>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <label htmlFor="tr-from">{t('from')}</label>
        <Input
          id="tr-from"
          type="date"
          style={{ width: 170 }}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label htmlFor="tr-to">{t('to')}</label>
        <Input
          id="tr-to"
          type="date"
          style={{ width: 170 }}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </Flex>
      {q.isError ? (
        <Alert type="error" showIcon message={message(q.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title={t('trialsStarted')} value={q.data?.started ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title={t('trialsConverted')} value={q.data?.converted ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title={t('trialsLost')} value={q.data?.lost ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic
              title={t('conversionRate')}
              value={
                rate == null
                  ? '—'
                  : `${(rate / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`
              }
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}

/** SA-38: reports (aged receivables, collections by method and period, trial conversions) with CSV export. */
export function ReportsPage() {
  const { t } = useTranslation('rep');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs
        items={[
          { key: 'aged', label: t('tabs.aged'), children: <AgedTab /> },
          { key: 'collections', label: t('tabs.collections'), children: <CollectionsTab /> },
          { key: 'trials', label: t('tabs.trials'), children: <TrialsTab /> },
        ]}
      />
    </>
  );
}
