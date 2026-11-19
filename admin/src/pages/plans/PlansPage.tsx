import { PlusOutlined } from '@ant-design/icons';
import { QUOTA_KEYS } from '@hm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, InputNumber, Switch, Table, Tabs, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { money, useAbilities } from '../../billing/common';
import type { Cycle } from '../../billing/common';
import type { Plan } from '../../billing/models';
import { AddonsTab } from './AddonsTab';
import { CouponsTab } from './CouponsTab';
import { FeaturePicker, PlanEditor, PriceGrid, QuotaEditor, pricesPayload } from './PlanEditor';
import type { QuotaMap } from './PlanEditor';
import { usePlans } from '../tenants/TenantsPage';

function CreatePlan({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trialDays, setTrialDays] = useState<number | null>(14);
  const [isPublic, setIsPublic] = useState(true);
  const [features, setFeatures] = useState<string[]>(['lodging.core', 'billing.core']);
  const [quotas, setQuotas] = useState<QuotaMap>(Object.fromEntries(QUOTA_KEYS.map((k) => [k, 0])));
  const [prices, setPrices] = useState<Partial<Record<Cycle, number | null>>>({});
  const create = useMutation({
    mutationFn: () =>
      apiClient.post('/plans', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        trialDays: trialDays ?? 0,
        isPublic,
        features,
        quotas,
        prices: pricesPayload(prices),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    },
  });
  return (
    <Drawer open width={720} title={t('create')} onClose={onClose}>
      <Form layout="vertical" component={false}>
        <Form.Item label={t('code')} htmlFor="np-code" extra={t('codeHint')} required>
          <Input
            id="np-code"
            value={code}
            maxLength={40}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Form.Item>
        <Form.Item label={t('name')} htmlFor="np-name" required>
          <Input
            id="np-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t('description')} htmlFor="np-desc">
          <Input.TextArea
            id="np-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t('trialDays')} htmlFor="np-trial">
          <InputNumber
            id="np-trial"
            min={0}
            max={365}
            precision={0}
            value={trialDays}
            onChange={setTrialDays}
          />
        </Form.Item>
        <Form.Item label={t('isPublic')}>
          <Switch checked={isPublic} onChange={setIsPublic} aria-label={t('isPublic')} />
        </Form.Item>
        <h3>{t('tabs.prices')}</h3>
        <PriceGrid value={prices} onChange={setPrices} />
        <h3>{t('tabs.quotas')}</h3>
        <QuotaEditor value={quotas} onChange={setQuotas} />
        <h3>{t('tabs.features')}</h3>
        <FeaturePicker value={features} onChange={setFeatures} />
      </Form>
      {create.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorText(create.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Button
        type="primary"
        disabled={!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code.trim()) || name.trim().length === 0}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        {t('createOk')}
      </Button>{' '}
      <Button onClick={onClose}>{tb('cancel')}</Button>
    </Drawer>
  );
}

function PlansTab() {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const can = useAbilities();
  const plans = usePlans();
  const message = useApiError();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      {can.admin ? (
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('create')}
          </Button>
        </div>
      ) : null}
      {plans.isError ? (
        <Alert type="error" showIcon message={message(plans.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<Plan>
        rowKey="id"
        loading={plans.isPending}
        dataSource={plans.data?.items ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('name'),
            render: (_: unknown, p) => (
              <>
                <strong>{p.name}</strong>
                <div style={{ opacity: 0.7 }}>{p.code}</div>
              </>
            ),
          },
          { title: t('trialDays'), dataIndex: 'trialDays', align: 'right' },
          {
            title: t('currentPrices'),
            render: (_: unknown, p) =>
              p.prices.length === 0
                ? '—'
                : p.prices.map((x) => (
                    <div key={x.id}>
                      {tb(`cycle.${x.billingCycle}`)} : {money(x.amount, x.currency)}
                    </div>
                  )),
          },
          { title: t('features'), render: (_: unknown, p) => p.features.length },
          { title: t('subscribers'), dataIndex: 'subscribers', align: 'right' },
          {
            title: tb('status'),
            render: (_: unknown, p) => (
              <>
                <Tag color={p.isActive ? 'green' : 'default'}>
                  {p.isActive ? t('active') : t('inactive')}
                </Tag>
                {p.isPublic ? <Tag>{t('public')}</Tag> : null}
              </>
            ),
          },
          {
            title: tb('actions'),
            key: 'a',
            render: (_: unknown, p) => (
              <Button size="small" onClick={() => setEditing(p.id)}>
                {can.admin ? t('edit') : t('view')}
              </Button>
            ),
          },
        ]}
      />
      {creating ? <CreatePlan onClose={() => setCreating(false)} /> : null}
      {editing ? <PlanEditor planId={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** SA-10…SA-14: plans (prices per cycle with history, trial, features, quotas), add-ons and coupons. */
export function PlansPage() {
  const { t } = useTranslation('plan');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs
        items={[
          { key: 'plans', label: t('tabs.plans'), children: <PlansTab /> },
          { key: 'addons', label: t('tabs.addons'), children: <AddonsTab /> },
          { key: 'coupons', label: t('tabs.coupons'), children: <CouponsTab /> },
        ]}
      />
    </>
  );
}
