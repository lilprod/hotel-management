import { CheckOutlined, MinusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Modal, Segmented, Skeleton, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FEATURE_KEYS, QUOTA_KEYS } from '@hm/shared';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { CYCLES, money, useFormatDate } from '../../billing/common';
import type { Cycle, PlanOffer, SubscriptionOverview } from '../../billing/common';

interface PlanChangeResult {
  mode: 'immediate' | 'scheduled';
  effectiveAt: string;
}

/** Same rule as the server: a higher price on the current cycle during a paid period = upgrade. */
export function isUpgrade(current: PlanOffer | undefined, target: PlanOffer, cycle: Cycle) {
  const from = current?.prices[cycle];
  const to = target.prices[cycle];
  return (
    current !== undefined && current.id !== target.id && from != null && to != null && to > from
  );
}

interface Row {
  key: string;
  label: string;
  group?: boolean;
  cells: Record<string, React.ReactNode>;
}

/** TN-32: plan comparison (features, quotas, price per cycle) and change request. */
export function PlansComparison({ overview }: { overview: SubscriptionOverview }) {
  const { t } = useTranslation('subscription');
  const message = useApiError();
  const fmt = useFormatDate();
  const qc = useQueryClient();
  const sub = overview.subscription;
  const [cycle, setCycle] = useState<Cycle>(sub?.billingCycle ?? 'MONTHLY');
  const [target, setTarget] = useState<PlanOffer | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: () => apiClient.get<{ items: PlanOffer[] }>('/billing/plans'),
  });
  const plans = useMemo(() => q.data?.items ?? [], [q.data]);
  const current = plans.find((p) => p.id === sub?.plan.id);
  const trialing = sub?.status === 'TRIALING';

  const change = useMutation({
    mutationFn: (p: PlanOffer) =>
      apiClient.post<PlanChangeResult>('/billing/plan-change', {
        planId: p.id,
        billingCycle: cycle,
      }),
    onSuccess: async (r) => {
      setTarget(null);
      setDone(r.mode === 'immediate' ? t('compare.doneImmediate') : t('compare.doneScheduled'));
      await qc.invalidateQueries({ queryKey: ['billing'] });
    },
  });

  const rows = useMemo<Row[]>(() => {
    const present = FEATURE_KEYS.filter((k) => plans.some((p) => p.features.includes(k)));
    const yes = (
      <span role="img" aria-label={t('compare.included')}>
        <CheckOutlined style={{ color: '#52c41a' }} />
      </span>
    );
    const no = (
      <span role="img" aria-label={t('compare.notIncluded')}>
        <MinusOutlined style={{ color: '#bfbfbf' }} />
      </span>
    );
    const each = (f: (p: PlanOffer) => React.ReactNode) =>
      Object.fromEntries(plans.map((p) => [p.id, f(p)]));
    return [
      {
        key: 'price',
        label: `${t('compare.price')} (${t(`cycle.${cycle}`).toLowerCase()})`,
        cells: each((p) => {
          const v = p.prices[cycle];
          return v === null ? t('compare.noPrice') : <strong>{money(v, p.currency)}</strong>;
        }),
      },
      { key: 'g-quotas', label: t('compare.quotas'), group: true, cells: {} },
      ...QUOTA_KEYS.map((k) => ({
        key: `q-${k}`,
        label: t(`quotas.${k}`),
        cells: each((p) =>
          p.quotas[k] === undefined
            ? '0'
            : p.quotas[k] === null
              ? t('unlimited')
              : String(p.quotas[k]),
        ),
      })),
      { key: 'g-features', label: t('compare.features'), group: true, cells: {} },
      ...present.map((k) => ({
        key: `f-${k}`,
        label: t(`features.${k.replace('.', '_')}`, { defaultValue: k }),
        cells: each((p) => (p.features.includes(k) ? yes : no)),
      })),
    ];
  }, [plans, cycle, t]);

  const upgrade = target ? isUpgrade(current, target, cycle) : false;
  const notice = trialing
    ? t('compare.trialNotice')
    : upgrade
      ? t('compare.upgradeNotice')
      : t('compare.downgradeNotice', { date: fmt.day(sub?.currentPeriodEnd) });

  return (
    <Card
      title={t('compare.title')}
      extra={
        <Segmented
          aria-label={t('compare.cycleLabel')}
          value={cycle}
          onChange={(v) => setCycle(v as Cycle)}
          options={CYCLES.map((c) => ({ value: c, label: t(`cycle.${c}`) }))}
        />
      }
    >
      {done ? (
        <Alert
          type="success"
          showIcon
          closable
          message={done}
          style={{ marginBottom: 12 }}
          onClose={() => setDone(null)}
        />
      ) : null}
      {q.isError ? <Alert type="error" showIcon message={message(q.error)} /> : null}
      {q.isPending ? <Skeleton active /> : null}
      {plans.length > 0 ? (
        <Table<Row>
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={rows}
          scroll={{ x: 'max-content' }}
          rowClassName={(r) => (r.group ? 'plan-group-row' : '')}
          columns={[
            {
              title: '',
              dataIndex: 'label',
              fixed: 'left',
              render: (l: string, r) => (r.group ? <strong>{l}</strong> : l),
            },
            ...plans.map((p) => ({
              title: (
                <div style={{ textAlign: 'center' }}>
                  <div>{p.name}</div>
                  {p.id === sub?.plan.id ? <Tag color="blue">{t('compare.current')}</Tag> : null}
                </div>
              ),
              key: p.id,
              align: 'center' as const,
              render: (_: unknown, r: Row) => r.cells[p.id] ?? null,
            })),
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} />
              {plans.map((p, i) => (
                <Table.Summary.Cell key={p.id} index={i + 1} align="center">
                  {p.id === sub?.plan.id && cycle === sub.billingCycle ? null : (
                    <Button
                      type="primary"
                      size="small"
                      disabled={p.prices[cycle] === null}
                      aria-label={`${t('compare.request')} — ${p.name}`}
                      onClick={() => setTarget(p)}
                    >
                      {t('compare.request')}
                    </Button>
                  )}
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          )}
        />
      ) : null}
      <Modal
        open={target !== null}
        title={t('compare.confirmTitle', { plan: target?.name ?? '' })}
        okText={t('compare.confirm')}
        cancelText={t('compare.cancel')}
        confirmLoading={change.isPending}
        onOk={() => target && change.mutate(target)}
        onCancel={() => {
          setTarget(null);
          change.reset();
        }}
      >
        <p>
          {target
            ? `${t(`cycle.${cycle}`)} — ${target.prices[cycle] === null ? '' : money(target.prices[cycle]!, target.currency)}`
            : null}
        </p>
        <Alert type={upgrade || trialing ? 'info' : 'warning'} showIcon message={notice} />
        {change.isError ? (
          <Alert
            style={{ marginTop: 8 }}
            type="error"
            showIcon
            role="alert"
            message={message(change.error)}
          />
        ) : null}
      </Modal>
    </Card>
  );
}
