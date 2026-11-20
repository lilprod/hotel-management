import { CheckCircleFilled } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Row,
  Segmented,
  Skeleton,
  Tag,
  Typography,
  theme,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { money } from '../billing/common';
import { CYCLES, fetchPlans, type Cycle, type PublicPlan } from './api';
import { SignupLayout } from './SignupLayout';

const QUOTA_ORDER = ['properties', 'units', 'users', 'storage_mb', 'sms_per_month'] as const;
const MAX_FEATURES = 8;

export function priceOf(plan: PublicPlan, cycle: Cycle) {
  return plan.prices.find((p) => p.billingCycle === cycle) ?? null;
}

function PlanCard({
  plan,
  cycle,
  highlight,
  onChoose,
}: {
  plan: PublicPlan;
  cycle: Cycle;
  highlight: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation('signup');
  const { token } = theme.useToken();
  const price = priceOf(plan, cycle);
  const features = plan.features.slice(0, MAX_FEATURES);
  return (
    <Card
      data-testid={`plan-${plan.code}`}
      style={{
        height: '100%',
        borderColor: highlight ? token.colorPrimary : undefined,
        borderWidth: highlight ? 2 : 1,
      }}
      styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%', gap: 12 } }}
    >
      <Flex justify="space-between" align="center">
        <Typography.Title level={3} style={{ margin: 0 }}>
          {plan.name}
        </Typography.Title>
        {highlight ? <Tag color="gold">{t('plan.popular')}</Tag> : null}
      </Flex>
      {plan.description ? (
        <Typography.Text type="secondary">{plan.description}</Typography.Text>
      ) : null}
      <div>
        {price ? (
          <>
            <Typography.Text strong style={{ fontSize: 28 }}>
              {money(price.amount, price.currency)}
            </Typography.Text>{' '}
            <Typography.Text type="secondary">{t(`cycle.per${cycle}`)}</Typography.Text>
          </>
        ) : (
          <Typography.Text type="secondary">{t('plan.noPrice')}</Typography.Text>
        )}
      </div>
      {plan.trialDays > 0 ? (
        <Tag color="green" style={{ alignSelf: 'flex-start' }}>
          {t('plan.trial', { count: plan.trialDays })}
        </Tag>
      ) : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1 }}>
        {QUOTA_ORDER.filter((k) => k in plan.quotas && k !== 'sms_per_month').map((k) => (
          <li key={k} style={{ marginBottom: 6 }}>
            <strong>{plan.quotas[k] === null ? t('quota.unlimited') : plan.quotas[k]}</strong>{' '}
            <Typography.Text type="secondary">{t(`quota.${k}`)}</Typography.Text>
          </li>
        ))}
        {features.map((f) => (
          <li key={f} style={{ marginBottom: 6 }}>
            <CheckCircleFilled style={{ color: token.colorSuccess, marginRight: 8 }} aria-hidden />
            {t(`features.${f}`, { defaultValue: f })}
          </li>
        ))}
      </ul>
      <Button type={highlight ? 'primary' : 'default'} size="large" block onClick={onChoose}>
        {t('plan.choose', { name: plan.name })}
      </Button>
    </Card>
  );
}

/** Marketing entry on the platform host: pitch, three plans (GET /public/plans), signup CTA. */
export function LandingPage() {
  const { t } = useTranslation('signup');
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [cycle, setCycle] = useState<Cycle>('MONTHLY');
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: fetchPlans,
    staleTime: 5 * 60_000,
  });
  const items = plans.data?.items ?? [];
  const middle = items.length === 3 ? 1 : -1;
  const choose = (code: string) =>
    navigate(`/signup/new?plan=${encodeURIComponent(code)}&cycle=${cycle}`);

  return (
    <SignupLayout>
      <section style={{ textAlign: 'center', padding: '48px 0 32px' }}>
        <Typography.Text style={{ color: token.colorPrimary, fontWeight: 600, letterSpacing: 0.4 }}>
          {t('landing.eyebrow')}
        </Typography.Text>
        <Typography.Title
          level={1}
          style={{ margin: '12px auto', maxWidth: 760, fontSize: 'clamp(28px, 5vw, 44px)' }}
        >
          {t('landing.title')}
        </Typography.Title>
        <Typography.Paragraph
          type="secondary"
          style={{ maxWidth: 640, margin: '0 auto 24px', fontSize: 17 }}
        >
          {t('landing.subtitle')}
        </Typography.Paragraph>
        <Button type="primary" size="large" onClick={() => navigate('/signup/new')}>
          {t('landing.cta')}
        </Button>
      </section>

      <Row gutter={[16, 16]} style={{ marginBottom: 40 }}>
        {(['one', 'two', 'three'] as const).map((k, i) => (
          <Col xs={24} md={8} key={k}>
            <Flex gap={12} align="flex-start">
              <span
                aria-hidden
                style={{
                  flex: '0 0 32px',
                  height: 32,
                  borderRadius: 16,
                  background: token.colorPrimary,
                  color: token.colorTextLightSolid,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </span>
              <div>
                <Typography.Text strong>{t(`landing.steps.${k}`)}</Typography.Text>
                <br />
                <Typography.Text type="secondary">{t(`landing.steps.${k}Text`)}</Typography.Text>
              </div>
            </Flex>
          </Col>
        ))}
      </Row>

      <section aria-labelledby="plans-title">
        <Typography.Title
          level={2}
          id="plans-title"
          style={{ textAlign: 'center', marginBottom: 4 }}
        >
          {t('landing.plansTitle')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          {t('landing.plansSubtitle')}
        </Typography.Paragraph>
        <Flex justify="center" style={{ marginBottom: 24 }}>
          <Segmented<Cycle>
            aria-label={t('cycle.label')}
            value={cycle}
            onChange={setCycle}
            options={CYCLES.map((c) => ({ value: c, label: t(`cycle.${c}`) }))}
          />
        </Flex>
        {plans.isLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} aria-label={t('landing.loading')} />
        ) : plans.isError ? (
          <Alert type="error" showIcon message={t('landing.error')} />
        ) : items.length === 0 ? (
          <Alert type="info" showIcon message={t('landing.empty')} />
        ) : (
          <Row gutter={[16, 16]} align="stretch">
            {items.map((plan, i) => (
              <Col xs={24} md={items.length >= 3 ? 8 : 12} key={plan.code}>
                <PlanCard
                  plan={plan}
                  cycle={cycle}
                  highlight={i === middle}
                  onChoose={() => choose(plan.code)}
                />
              </Col>
            ))}
          </Row>
        )}
      </section>
    </SignupLayout>
  );
}
