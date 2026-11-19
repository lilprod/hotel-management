import { PlusOutlined } from '@ant-design/icons';
import { FEATURE_KEYS, QUOTA_KEYS } from '@hm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Switch, Table, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { money, useAbilities } from '../../billing/common';
import type { Cycle } from '../../billing/common';
import type { Addon } from '../../billing/models';
import { NewPriceForm, PriceGrid, PriceHistory, pricesPayload } from './PlanEditor';

function QuotaDeltas({
  value,
  onChange,
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const { t: tt } = useTranslation('ten');
  return (
    <div>
      {QUOTA_KEYS.map((k) => (
        <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <label htmlFor={`delta-${k}`} style={{ width: 200 }}>
            {tt(`quota.${k}`)}
          </label>
          <InputNumber
            id={`delta-${k}`}
            min={0}
            precision={0}
            value={value[k] ?? 0}
            onChange={(v) => onChange({ ...value, [k]: v ?? 0 })}
          />
        </div>
      ))}
    </div>
  );
}

const nonZero = (d: Record<string, number>) =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v > 0));

function AddonDrawer({ addon, onClose }: { addon: Addon | 'new'; onClose: () => void }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const isNew = addon === 'new';
  const [code, setCode] = useState('');
  const [name, setName] = useState(isNew ? '' : addon.name);
  const [description, setDescription] = useState(isNew ? '' : (addon.description ?? ''));
  const [featureKeys, setFeatureKeys] = useState<string[]>(isNew ? [] : addon.featureKeys);
  const [deltas, setDeltas] = useState<Record<string, number>>(isNew ? {} : addon.quotaDeltas);
  const [isActive, setIsActive] = useState(isNew ? true : addon.isActive);
  const [prices, setPrices] = useState<Partial<Record<Cycle, number | null>>>({});
  const save = useMutation({
    mutationFn: () =>
      isNew
        ? apiClient.post('/addons', {
            code: code.trim().toUpperCase(),
            name: name.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            featureKeys,
            quotaDeltas: nonZero(deltas),
            isActive,
            prices: pricesPayload(prices),
          })
        : apiClient.patch(`/addons/${addon.id}`, {
            name: name.trim(),
            description: description.trim() || null,
            featureKeys,
            quotaDeltas: nonZero(deltas),
            isActive,
          }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['addons'] });
      onClose();
    },
  });
  const valid =
    name.trim().length > 0 && (!isNew || /^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code.trim()));
  return (
    <Drawer open width={640} title={isNew ? t('addonCreate') : addon.name} onClose={onClose}>
      <Form layout="vertical" component={false}>
        {isNew ? (
          <Form.Item label={t('code')} htmlFor="ad-code" extra={t('codeHint')} required>
            <Input
              id="ad-code"
              value={code}
              maxLength={40}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Form.Item>
        ) : null}
        <Form.Item label={t('name')} htmlFor="ad-name" required>
          <Input
            id="ad-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t('description')} htmlFor="ad-desc">
          <Input.TextArea
            id="ad-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t('addonFeatures')} htmlFor="ad-features">
          <Select
            id="ad-features"
            mode="multiple"
            value={featureKeys}
            onChange={setFeatureKeys}
            options={FEATURE_KEYS.map((k) => ({ value: k, label: k }))}
          />
        </Form.Item>
        <h3>{t('quotaDeltas')}</h3>
        <QuotaDeltas value={deltas} onChange={setDeltas} />
        <Form.Item label={t('isActive')}>
          <Switch checked={isActive} onChange={setIsActive} aria-label={t('isActive')} />
        </Form.Item>
        {isNew ? (
          <>
            <h3>{t('tabs.prices')}</h3>
            <PriceGrid value={prices} onChange={setPrices} />
          </>
        ) : null}
      </Form>
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
        disabled={!valid}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        {tb('save')}
      </Button>
      {!isNew ? (
        <div style={{ marginTop: 24 }}>
          <h3>{t('priceHistory')}</h3>
          <PriceHistory prices={addon.prices} />
          <NewPriceForm path={`/addons/${addon.id}/prices`} invalidate={[['addons']]} />
        </div>
      ) : null}
    </Drawer>
  );
}

/** SA-12: add-ons (features / quota increments, priced per cycle with version history). */
export function AddonsTab() {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const can = useAbilities();
  const [editing, setEditing] = useState<Addon | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['addons'],
    queryFn: () => apiClient.get<{ items: Addon[] }>('/addons'),
  });
  return (
    <>
      {can.admin ? (
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('addonCreate')}
          </Button>
        </div>
      ) : null}
      {q.isError ? (
        <Alert type="error" showIcon message={message(q.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<Addon>
        rowKey="id"
        loading={q.isPending}
        dataSource={q.data?.items ?? []}
        pagination={false}
        locale={{ emptyText: t('noAddon') }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('name'),
            render: (_: unknown, a) => (
              <>
                <strong>{a.name}</strong>
                <div style={{ opacity: 0.7 }}>{a.code}</div>
              </>
            ),
          },
          {
            title: t('currentPrices'),
            render: (_: unknown, a) =>
              a.prices.filter((p) => !p.validTo).length === 0
                ? '—'
                : a.prices
                    .filter((p) => !p.validTo)
                    .map((p) => (
                      <div key={p.id}>
                        {tb(`cycle.${p.billingCycle}`)} : {money(p.amount, p.currency)}
                      </div>
                    )),
          },
          {
            title: t('addonEffects'),
            render: (_: unknown, a) => (
              <>
                {a.featureKeys.map((k) => (
                  <Tag key={k}>{k}</Tag>
                ))}
                {Object.entries(a.quotaDeltas).map(([k, v]) => (
                  <Tag key={k} color="blue">
                    {k} +{v}
                  </Tag>
                ))}
              </>
            ),
          },
          {
            title: tb('status'),
            dataIndex: 'isActive',
            render: (v: boolean) => (
              <Tag color={v ? 'green' : 'default'}>{v ? t('active') : t('inactive')}</Tag>
            ),
          },
          {
            title: tb('actions'),
            key: 'a',
            render: (_: unknown, a) => (
              <Button size="small" onClick={() => setEditing(a)}>
                {can.admin ? t('edit') : t('view')}
              </Button>
            ),
          },
        ]}
      />
      {editing ? <AddonDrawer addon={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
