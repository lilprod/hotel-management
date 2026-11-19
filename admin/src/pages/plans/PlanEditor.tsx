import { QUOTA_KEYS } from '@hm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Table,
  Tabs,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { CYCLES, money, todayIso, useFormatDate } from '../../billing/common';
import type { Cycle } from '../../billing/common';
import { groupedFeatures } from '../../billing/features';
import type { Plan, PlanPrice } from '../../billing/models';

export type QuotaMap = Record<string, number | null>;

/** Features grouped by area (checkboxes). */
export function FeaturePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('plan');
  const toggle = (k: string, on: boolean) =>
    onChange(on ? [...new Set([...value, k])] : value.filter((x) => x !== k));
  return (
    <div>
      {groupedFeatures().map((g) => (
        <fieldset key={g.id} style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t(`featureGroups.${g.id}`)}</legend>
          {g.keys.map((k) => (
            <Checkbox
              key={k}
              checked={value.includes(k)}
              disabled={disabled ?? false}
              onChange={(e) => toggle(k, e.target.checked)}
              style={{ minWidth: 220, marginInlineStart: 0 }}
            >
              <code>{k}</code>
            </Checkbox>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** Quota limits (empty / "illimité" = null). */
export function QuotaEditor({
  value,
  onChange,
  disabled,
}: {
  value: QuotaMap;
  onChange: (v: QuotaMap) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('plan');
  const { t: tt } = useTranslation('ten');
  return (
    <div>
      {QUOTA_KEYS.map((k) => {
        const limit = value[k];
        const unlimited = limit === null;
        return (
          <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <label htmlFor={`quota-${k}`} style={{ width: 200 }}>
              {tt(`quota.${k}`)}
            </label>
            <InputNumber
              id={`quota-${k}`}
              min={0}
              precision={0}
              disabled={(disabled ?? false) || unlimited}
              value={unlimited ? null : (limit ?? 0)}
              onChange={(v) => onChange({ ...value, [k]: v ?? 0 })}
            />
            <Checkbox
              checked={unlimited}
              disabled={disabled ?? false}
              onChange={(e) => onChange({ ...value, [k]: e.target.checked ? null : 0 })}
            >
              {t('unlimited')}
            </Checkbox>
          </div>
        );
      })}
    </div>
  );
}

/** One integer price per billing cycle (create form). */
export function PriceGrid({
  value,
  onChange,
}: {
  value: Partial<Record<Cycle, number | null>>;
  onChange: (v: Partial<Record<Cycle, number | null>>) => void;
}) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  return (
    <div>
      {CYCLES.map((c) => (
        <div key={c} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <label htmlFor={`price-${c}`} style={{ width: 160 }}>
            {tb(`cycle.${c}`)}
          </label>
          <InputNumber
            id={`price-${c}`}
            min={0}
            precision={0}
            step={1000}
            suffix="FCFA"
            placeholder={t('noPrice')}
            value={value[c] ?? null}
            onChange={(v) => onChange({ ...value, [c]: v })}
          />
        </div>
      ))}
    </div>
  );
}

export function pricesPayload(value: Partial<Record<Cycle, number | null>>) {
  return CYCLES.flatMap((c) =>
    value[c] === null || value[c] === undefined
      ? []
      : [{ billingCycle: c, currency: 'XOF', amount: value[c] as number }],
  );
}

/** Version history of the prices (never edited in place: a new version is added from a date). */
export function PriceHistory({ prices, current }: { prices: PlanPrice[]; current?: PlanPrice[] }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const fmt = useFormatDate();
  const currentIds = new Set((current ?? []).map((p) => p.id));
  return (
    <Table<PlanPrice>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={prices}
      locale={{ emptyText: t('noPriceHistory') }}
      columns={[
        { title: t('cycle'), dataIndex: 'billingCycle', render: (c: Cycle) => tb(`cycle.${c}`) },
        {
          title: tb('amount'),
          dataIndex: 'amount',
          align: 'right',
          render: (a: number, p) => money(a, p.currency),
        },
        { title: t('validFrom'), dataIndex: 'validFrom', render: (d: string | null) => fmt.day(d) },
        {
          title: t('validTo'),
          dataIndex: 'validTo',
          render: (d: string | null, p) =>
            currentIds.has(p.id) && !d ? t('inForce') : d ? fmt.day(d) : '—',
        },
      ]}
    />
  );
}

/** New price version: cycle, amount, effective date (today or later, never retroactive). */
export function NewPriceForm({ path, invalidate }: { path: string; invalidate: unknown[][] }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const [cycle, setCycle] = useState<Cycle>('MONTHLY');
  const [amount, setAmount] = useState<number | null>(null);
  const [validFrom, setValidFrom] = useState(todayIso());
  const add = useMutation({
    mutationFn: () =>
      apiClient.post(path, { billingCycle: cycle, currency: 'XOF', amount, validFrom }),
    onSuccess: async () => {
      setAmount(null);
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <label>
          {t('cycle')}
          <br />
          <Select<Cycle>
            value={cycle}
            onChange={setCycle}
            style={{ minWidth: 160 }}
            options={CYCLES.map((c) => ({ value: c, label: tb(`cycle.${c}`) }))}
          />
        </label>
        <label>
          {t('newAmount')}
          <br />
          <InputNumber min={0} precision={0} step={1000} value={amount} onChange={setAmount} />
        </label>
        <label>
          {t('validFrom')}
          <br />
          <Input
            type="date"
            min={todayIso()}
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            style={{ width: 160 }}
          />
        </label>
        <Button
          type="primary"
          disabled={amount === null}
          loading={add.isPending}
          onClick={() => add.mutate()}
        >
          {t('addPrice')}
        </Button>
      </div>
      {add.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorText(add.error)}
          style={{ marginTop: 8 }}
        />
      ) : null}
    </div>
  );
}

const diff = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function GeneralForm({ plan }: { plan: Plan }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? '');
  const [trialDays, setTrialDays] = useState<number | null>(plan.trialDays);
  const [sort, setSort] = useState<number | null>(plan.sort);
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [isActive, setIsActive] = useState(plan.isActive);
  const save = useMutation({
    mutationFn: () =>
      apiClient.patch(`/plans/${plan.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        trialDays: trialDays ?? 0,
        sort: sort ?? 0,
        isPublic,
        isActive,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  return (
    <Form layout="vertical" component={false}>
      <Form.Item label={t('name')} htmlFor="pl-name" required>
        <Input
          id="pl-name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </Form.Item>
      <Form.Item label={t('description')} htmlFor="pl-desc">
        <Input.TextArea
          id="pl-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Form.Item>
      <Form.Item label={t('trialDays')} htmlFor="pl-trial">
        <InputNumber
          id="pl-trial"
          min={0}
          max={365}
          precision={0}
          value={trialDays}
          onChange={setTrialDays}
        />
      </Form.Item>
      <Form.Item label={t('sort')} htmlFor="pl-sort">
        <InputNumber id="pl-sort" min={0} precision={0} value={sort} onChange={setSort} />
      </Form.Item>
      <Form.Item label={t('isPublic')}>
        <Switch checked={isPublic} onChange={setIsPublic} aria-label={t('isPublic')} />
      </Form.Item>
      <Form.Item label={t('isActive')}>
        <Switch checked={isActive} onChange={setIsActive} aria-label={t('isActive')} />
      </Form.Item>
      {save.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorText(save.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Button
        type="primary"
        loading={save.isPending}
        disabled={name.trim().length === 0}
        onClick={() => save.mutate()}
      >
        {tb('save')}
      </Button>
    </Form>
  );
}

function FeaturesForm({ plan }: { plan: Plan }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const [features, setFeatures] = useState(plan.features);
  const save = useMutation({
    mutationFn: () => apiClient.put(`/plans/${plan.id}/features`, { features }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  return (
    <>
      <Alert
        type="info"
        showIcon
        message={t('featuresHint', { count: plan.subscribers ?? 0 })}
        style={{ marginBottom: 12 }}
      />
      <FeaturePicker value={features} onChange={setFeatures} />
      {save.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorText(save.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Button
        type="primary"
        disabled={diff(features, plan.features)}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        {tb('save')}
      </Button>
    </>
  );
}

function QuotasForm({ plan }: { plan: Plan }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const [quotas, setQuotas] = useState<QuotaMap>(() =>
    Object.fromEntries(QUOTA_KEYS.map((k) => [k, k in plan.quotas ? (plan.quotas[k] ?? null) : 0])),
  );
  const save = useMutation({
    mutationFn: () => apiClient.put(`/plans/${plan.id}/quotas`, { quotas }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  return (
    <>
      <Alert type="info" showIcon message={t('quotasHint')} style={{ marginBottom: 12 }} />
      <QuotaEditor value={quotas} onChange={setQuotas} />
      {save.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorText(save.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>
        {tb('save')}
      </Button>
    </>
  );
}

/** Editor of an existing plan: general data, prices per cycle with version history, features, quotas. */
export function PlanEditor({ planId, onClose }: { planId: string; onClose: () => void }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['plan', planId],
    queryFn: () => apiClient.get<Plan>(`/plans/${planId}`),
  });
  const archive = useMutation({
    mutationFn: () => apiClient.delete(`/plans/${planId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    },
  });
  const plan = q.data;
  const reload = () => ['plan', planId];
  return (
    <Drawer
      open
      width={720}
      title={plan ? `${plan.name} (${plan.code})` : t('edit')}
      onClose={onClose}
    >
      {q.isError ? <Alert type="error" showIcon message={errorText(q.error)} /> : null}
      {plan ? (
        <>
          <Tabs
            items={[
              {
                key: 'general',
                label: t('tabs.general'),
                children: <GeneralForm key={`g-${plan.id}`} plan={plan} />,
              },
              {
                key: 'prices',
                label: t('tabs.prices'),
                children: (
                  <Card size="small">
                    <h3>{t('currentPrices')}</h3>
                    <PriceHistory prices={plan.prices} current={plan.prices} />
                    <h3 style={{ marginTop: 16 }}>{t('priceHistory')}</h3>
                    <PriceHistory prices={plan.priceHistory} current={plan.prices} />
                    <NewPriceForm
                      path={`/plans/${plan.id}/prices`}
                      invalidate={[reload(), ['plans']]}
                    />
                  </Card>
                ),
              },
              {
                key: 'features',
                label: t('tabs.features'),
                children: <FeaturesForm key={`f-${plan.id}`} plan={plan} />,
              },
              {
                key: 'quotas',
                label: t('tabs.quotas'),
                children: <QuotasForm key={`q-${plan.id}`} plan={plan} />,
              },
            ]}
          />
          {archive.isError ? (
            <Alert
              type="error"
              showIcon
              role="alert"
              message={errorText(archive.error)}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <Button
            danger
            disabled={(plan.subscribers ?? 0) > 0}
            loading={archive.isPending}
            onClick={() => archive.mutate()}
          >
            {t('archive')}
          </Button>
          {(plan.subscribers ?? 0) > 0 ? (
            <span style={{ marginLeft: 8, opacity: 0.7 }}>
              {t('archiveBlocked', { count: plan.subscribers })}
            </span>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <Button onClick={onClose}>{tb('close')}</Button>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
