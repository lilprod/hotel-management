import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Progress, Row, Skeleton, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { daysBetween, money, useFormatDate } from '../../billing/common';
import type { QuotaUsage, SubStatus, SubscriptionOverview } from '../../billing/common';
import { DocumentsSection } from './DocumentsSection';
import { PaymentSection } from './PaymentSection';
import { PlansComparison } from './PlansComparison';

const STATUS_COLORS: Record<SubStatus, string> = {
  TRIALING: 'blue',
  ACTIVE: 'green',
  PAST_DUE: 'orange',
  SUSPENDED: 'red',
  CANCELLED: 'default',
};

export const overviewKey = ['billing', 'subscription'] as const;

function QuotaBar({ quota }: { quota: QuotaUsage }) {
  const { t } = useTranslation('subscription');
  const label = t(`quotas.${quota.key}`, { defaultValue: quota.key });
  const unlimited = quota.limit === null;
  const percent =
    unlimited || !quota.limit ? 0 : Math.min(100, Math.round((quota.used / quota.limit) * 100));
  const status = !unlimited && percent >= 100 ? 'exception' : 'normal';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span id={`quota-${quota.key}`}>{label}</span>
        <span>
          {quota.used} / {unlimited ? t('unlimited') : quota.limit}
        </span>
      </div>
      <Progress
        percent={percent}
        status={status}
        strokeColor={!unlimited && percent >= 80 && percent < 100 ? '#faad14' : undefined}
        showInfo={false}
        aria-labelledby={`quota-${quota.key}`}
      />
    </div>
  );
}

function PlanCard({ data }: { data: SubscriptionOverview }) {
  const { t } = useTranslation('subscription');
  const fmt = useFormatDate();
  const sub = data.subscription;
  if (!sub) return <Alert type="info" showIcon message={t('plan.none')} />;
  const target = sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd;
  const left = target ? daysBetween(data.today, target) : null;
  const countdown =
    left === null ? '' : left <= 0 ? t('plan.today') : t('plan.daysLeft', { count: left });
  return (
    <Card
      title={t('plan.title')}
      extra={<Tag color={STATUS_COLORS[sub.status]}>{t(`status.${sub.status}`)}</Tag>}
    >
      <Descriptions column={1} size="small">
        <Descriptions.Item label={t('plan.title')}>
          <strong>{sub.plan.name}</strong>
        </Descriptions.Item>
        <Descriptions.Item label={t('plan.cycle')}>
          {t(`cycle.${sub.billingCycle}`)}
        </Descriptions.Item>
        <Descriptions.Item
          label={sub.status === 'TRIALING' ? t('plan.trialEnd') : t('plan.periodEnd')}
        >
          {fmt.day(target)}
          {countdown ? ` (${countdown})` : ''}
        </Descriptions.Item>
        <Descriptions.Item label={t('plan.amountDue')}>
          {money(data.amountDue, data.currency)}
        </Descriptions.Item>
        {data.credit > 0 ? (
          <Descriptions.Item label={t('plan.credit')}>
            {money(data.credit, data.currency)}
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      {sub.pendingChange ? (
        <Alert
          style={{ marginTop: 8 }}
          type="info"
          showIcon
          message={t('plan.pending', {
            plan: sub.pendingChange.plan?.name ?? '',
            cycle: t(`cycle.${sub.pendingChange.billingCycle}`),
            date: fmt.day(sub.pendingChange.effectiveAt),
          })}
        />
      ) : null}
      {sub.cancelAt ? (
        <Alert
          style={{ marginTop: 8 }}
          type="warning"
          showIcon
          message={t('plan.cancelAt', { date: fmt.day(sub.cancelAt) })}
        />
      ) : null}
    </Card>
  );
}

/** TN-30…TN-34: the tenant's subscription (plan, usage, comparison, invoices, payments). */
export function SubscriptionPage() {
  const { t } = useTranslation('subscription');
  const message = useApiError();
  const q = useQuery({
    queryKey: overviewKey,
    queryFn: () => apiClient.get<SubscriptionOverview>('/billing/subscription'),
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {q.isError ? (
        <Alert
          type="error"
          showIcon
          message={t('loadError')}
          description={message(q.error)}
          action={
            <Button size="small" onClick={() => void q.refetch()}>
              {t('retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {q.isPending ? <Skeleton active /> : null}
      {q.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <PlanCard data={q.data} />
            </Col>
            <Col xs={24} lg={12}>
              <Card title={t('usage.title')}>
                {q.data.quotas.map((quota) => (
                  <QuotaBar key={quota.key} quota={quota} />
                ))}
              </Card>
            </Col>
          </Row>
          <PlansComparison overview={q.data} />
          <PaymentSection />
          <DocumentsSection />
        </div>
      ) : null}
    </>
  );
}
