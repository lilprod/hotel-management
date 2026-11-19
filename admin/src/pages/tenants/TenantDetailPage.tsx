import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Progress,
  Row,
  Select,
  Skeleton,
  Table,
  Tabs,
  Tag,
  Timeline,
  Input,
} from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { money, useAbilities, useFormatDate } from '../../billing/common';
import type { Invoice, Payment } from '../../billing/common';
import type { TenantDetail } from '../../billing/models';
import { InvoiceStatusTag, PaymentStatusTag, SubStatusTag, useMethodLabel } from '../../billing/ui';
import { ExtrasTab } from './ExtrasTab';
import { SubscriptionActions } from './SubscriptionActions';

export function QuotaBars({ usage }: { usage: TenantDetail['quotaUsage'] }) {
  const { t } = useTranslation('ten');
  return (
    <div>
      {usage.map((q) => {
        const unlimited = q.limit === null;
        const percent =
          unlimited || q.limit === 0 ? 0 : Math.min(100, Math.round((q.used / q.limit!) * 100));
        const over = !unlimited && q.used > (q.limit ?? 0);
        return (
          <div key={q.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span id={`quota-${q.key}`}>{t(`quota.${q.key}`)}</span>
              <span>
                {q.used} / {unlimited ? t('unlimited') : q.limit}
              </span>
            </div>
            <Progress
              aria-labelledby={`quota-${q.key}`}
              percent={percent}
              showInfo={false}
              status={over ? 'exception' : percent >= 90 ? 'active' : 'normal'}
              strokeColor={over ? undefined : percent >= 90 ? '#fa8c16' : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

function Overview({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation('ten');
  const { t: tb } = useTranslation('billing');
  const fmt = useFormatDate();
  const sub = tenant.subscription;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card size="small" title={t('subscription')}>
          {sub ? (
            <Descriptions column={{ xs: 1, md: 2 }} size="small">
              <Descriptions.Item label={tb('status')}>
                <SubStatusTag status={sub.status} />
              </Descriptions.Item>
              <Descriptions.Item label={t('plan')}>{sub.plan.name}</Descriptions.Item>
              <Descriptions.Item label={t('cycle')}>
                {tb(`cycle.${sub.billingCycle}`)}
              </Descriptions.Item>
              <Descriptions.Item label={t('trialEnds')}>
                {fmt.day(sub.trialEndsAt)}
              </Descriptions.Item>
              <Descriptions.Item label={t('periodStart')}>
                {fmt.day(sub.currentPeriodStart)}
              </Descriptions.Item>
              <Descriptions.Item label={t('periodEnd')}>
                {fmt.day(sub.currentPeriodEnd)}
              </Descriptions.Item>
              <Descriptions.Item label={t('graceEnds')}>
                {fmt.day(sub.graceEndsAt)}
              </Descriptions.Item>
              <Descriptions.Item label={t('cancelAt')}>{fmt.day(sub.cancelAt)}</Descriptions.Item>
              {sub.pendingChange ? (
                <Descriptions.Item label={t('pendingChange')} span={2}>
                  {t('pendingChangeText', {
                    cycle: tb(`cycle.${sub.pendingChange.billingCycle}`),
                    date: fmt.day(sub.pendingChange.effectiveAt),
                  })}
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label={t('credit')}>
                {money(tenant.credit, tenant.currency)}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Empty description={t('noSubscription')} />
          )}
        </Card>
        <Card size="small" title={t('contact')} style={{ marginTop: 16 }}>
          <Descriptions column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label={t('legalName')}>{tenant.legalName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('accountStatus')}>
              {t(`accountStatuses.${tenant.status}`)}
            </Descriptions.Item>
            <Descriptions.Item label="E-mail">{tenant.email ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('phone')}>{tenant.phone ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('country')}>{tenant.country}</Descriptions.Item>
            <Descriptions.Item label={t('timezone')}>{tenant.timezone}</Descriptions.Item>
            <Descriptions.Item label={t('domains')} span={2}>
              {tenant.domains.length ? tenant.domains.map((d) => d.hostname).join(', ') : '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card size="small" title={t('quotas')}>
          <QuotaBars usage={tenant.quotaUsage} />
        </Card>
        <Card size="small" title={t('history')} style={{ marginTop: 16 }}>
          {tenant.events.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noEvent')} />
          ) : (
            <Timeline
              items={tenant.events.slice(0, 10).map((e) => ({
                children: (
                  <>
                    <strong>
                      {e.from ? tb(`subStatus.${e.from}`) : '∅'} → {tb(`subStatus.${e.to}`)}
                    </strong>
                    <div style={{ opacity: 0.7 }}>
                      {fmt.dateTime(e.at)}
                      {e.reason ? ` · ${e.reason}` : ''}
                    </div>
                  </>
                ),
              }))}
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}

function InvoicesTab({ invoices }: { invoices: Invoice[] }) {
  const { t } = useTranslation('ten');
  const fmt = useFormatDate();
  return (
    <Table<Invoice>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={invoices}
      locale={{ emptyText: t('noInvoice') }}
      scroll={{ x: 'max-content' }}
      columns={[
        {
          title: t('invoice'),
          dataIndex: 'number',
          render: (n: string, i) => <Link to={`/invoices/${i.id}`}>{n}</Link>,
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
          title: t('status'),
          dataIndex: 'status',
          render: (_: unknown, i) => <InvoiceStatusTag status={i.overdue ? 'OVERDUE' : i.status} />,
        },
      ]}
    />
  );
}

function PaymentsTab({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation('ten');
  const methodLabel = useMethodLabel();
  const fmt = useFormatDate();
  const can = useAbilities();
  return (
    <>
      {can.finance ? (
        <div style={{ marginBottom: 12 }}>
          <Link to={`/payments/new?tenantId=${tenant.id}`}>
            <Button type="primary">{t('recordPayment')}</Button>
          </Link>
        </div>
      ) : null}
      <Table<Payment>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={tenant.payments}
        locale={{ emptyText: t('noPayment') }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: t('date'), dataIndex: 'paidAt', render: (d: string) => fmt.day(d) },
          {
            title: t('receipt'),
            dataIndex: 'receiptNumber',
            render: (n: string | null, p) => <Link to={`/payments/${p.id}`}>{n ?? '—'}</Link>,
          },
          {
            title: t('amount'),
            dataIndex: 'amount',
            align: 'right',
            render: (a: number, p) => money(a, p.currency),
          },
          { title: t('method'), dataIndex: 'method', render: (m: string) => methodLabel(m) },
          { title: t('reference'), dataIndex: 'reference', render: (r: string | null) => r ?? '—' },
          {
            title: t('status'),
            dataIndex: 'status',
            render: (s: Payment['status']) => <PaymentStatusTag status={s} />,
          },
        ]}
      />
    </>
  );
}

function NotesTab({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation('ten');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const can = useAbilities();
  const qc = useQueryClient();
  const [notes, setNotes] = useState(tenant.notes ?? '');
  const [tags, setTags] = useState<string[]>(tenant.tags);
  useEffect(() => {
    setNotes(tenant.notes ?? '');
    setTags(tenant.tags);
  }, [tenant.notes, tenant.tags]);
  const save = useMutation({
    mutationFn: () =>
      apiClient.patch(`/tenants/${tenant.id}`, { notes: notes.trim() || null, tags }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', tenant.id] }),
  });
  return (
    <Card size="small" style={{ maxWidth: 720 }}>
      <label htmlFor="tenant-tags">{t('tags')}</label>
      {can.editTenantNotes ? (
        <Select
          id="tenant-tags"
          mode="tags"
          style={{ width: '100%', marginBottom: 16 }}
          value={tags}
          onChange={setTags}
          tokenSeparators={[',']}
          maxCount={20}
        />
      ) : (
        <div style={{ marginBottom: 16 }}>
          {tenant.tags.length ? tenant.tags.map((x) => <Tag key={x}>{x}</Tag>) : '—'}
        </div>
      )}
      <label htmlFor="tenant-notes">{t('notes')}</label>
      <Input.TextArea
        id="tenant-notes"
        rows={6}
        maxLength={5000}
        readOnly={!can.editTenantNotes}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ marginBottom: 16 }}
      />
      {save.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorText(save.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {can.editTenantNotes ? (
        <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {tb('save')}
        </Button>
      ) : null}
    </Card>
  );
}

/** SA-21: tenant card (overview + quotas, subscription actions, invoices, payments, extras, notes). */
export function TenantDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation('ten');
  const message = useApiError();
  const can = useAbilities();
  const q = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => apiClient.get<TenantDetail>(`/tenants/${id}`),
  });
  const tenant = q.data;
  return (
    <>
      <PageHeader
        title={tenant?.name ?? t('detail')}
        subtitle={tenant ? `${tenant.slug} · ${tenant.currency}` : undefined}
        breadcrumb={[
          { title: <Link to="/tenants">{t('title')}</Link> },
          { title: tenant?.name ?? t('detail') },
        ]}
        actions={tenant && can.admin ? <SubscriptionActions tenant={tenant} /> : null}
      />
      {q.isError ? <Alert type="error" showIcon message={message(q.error)} /> : null}
      {q.isPending ? <Skeleton active /> : null}
      {tenant ? (
        <Tabs
          defaultActiveKey="overview"
          items={[
            { key: 'overview', label: t('tabs.overview'), children: <Overview tenant={tenant} /> },
            {
              key: 'invoices',
              label: t('tabs.invoices'),
              children: <InvoicesTab invoices={tenant.invoices} />,
            },
            {
              key: 'payments',
              label: t('tabs.payments'),
              children: <PaymentsTab tenant={tenant} />,
            },
            { key: 'extras', label: t('tabs.extras'), children: <ExtrasTab tenant={tenant} /> },
            { key: 'notes', label: t('tabs.notes'), children: <NotesTab tenant={tenant} /> },
          ]}
        />
      ) : null}
    </>
  );
}
