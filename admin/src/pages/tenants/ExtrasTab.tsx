import { FEATURE_KEYS, QUOTA_KEYS } from '@hm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { useAbilities, useFormatDate } from '../../billing/common';
import type { Addon, TenantDetail, TenantOverride } from '../../billing/models';

type Kind = TenantOverride['kind'];

function describe(
  o: TenantOverride,
  t: (k: string, p?: Record<string, unknown>) => string,
): string {
  const v = o.value as {
    enabled?: boolean;
    limit?: number | null;
    percent?: number;
    amount?: number;
  };
  if (o.kind === 'FEATURE') return v.enabled ? t('extras.granted') : t('extras.revoked');
  if (o.kind === 'QUOTA') return v.limit == null ? t('extras.unlimited') : String(v.limit);
  return v.percent != null ? `${v.percent} %` : `${v.amount ?? 0} FCFA`;
}

function OverrideModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const { t } = useTranslation('ten');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('FEATURE');
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState<number | null>(null);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discount, setDiscount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const value =
        kind === 'FEATURE'
          ? { enabled }
          : kind === 'QUOTA'
            ? { limit }
            : { [discountType]: discount };
      return apiClient.post(`/tenants/${tenantId}/overrides`, {
        kind,
        key: key.trim(),
        value,
        endsAt: null,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  const valid = key.trim().length > 0 && (kind !== 'DISCOUNT' || (discount ?? 0) > 0);
  return (
    <Modal
      open
      title={t('extras.addOverride')}
      okText={tb('save')}
      cancelText={tb('cancel')}
      okButtonProps={{ disabled: !valid }}
      confirmLoading={save.isPending}
      onOk={() => save.mutate()}
      onCancel={onClose}
    >
      <Form layout="vertical" component={false}>
        <Form.Item label={t('extras.kind')} htmlFor="ov-kind">
          <Select
            id="ov-kind"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setKey('');
            }}
            options={(['FEATURE', 'QUOTA', 'DISCOUNT'] as const).map((k) => ({
              value: k,
              label: t(`extras.kinds.${k}`),
            }))}
          />
        </Form.Item>
        <Form.Item label={t('extras.key')} htmlFor="ov-key" required>
          {kind === 'DISCOUNT' ? (
            <Input
              id="ov-key"
              value={key}
              maxLength={100}
              onChange={(e) => setKey(e.target.value)}
            />
          ) : (
            <Select
              id="ov-key"
              showSearch
              value={key || undefined}
              onChange={setKey}
              options={(kind === 'FEATURE' ? FEATURE_KEYS : QUOTA_KEYS).map((k) => ({
                value: k,
                label: k,
              }))}
            />
          )}
        </Form.Item>
        {kind === 'FEATURE' ? (
          <Form.Item label={t('extras.granted')}>
            <Switch checked={enabled} onChange={setEnabled} aria-label={t('extras.granted')} />
          </Form.Item>
        ) : null}
        {kind === 'QUOTA' ? (
          <Form.Item label={t('extras.limit')} extra={t('extras.limitHint')} htmlFor="ov-limit">
            <InputNumber id="ov-limit" min={0} precision={0} value={limit} onChange={setLimit} />
          </Form.Item>
        ) : null}
        {kind === 'DISCOUNT' ? (
          <Form.Item label={t('extras.discount')} htmlFor="ov-discount">
            <Select
              aria-label={t('extras.discountType')}
              value={discountType}
              onChange={setDiscountType}
              style={{ width: 160, marginRight: 8 }}
              options={[
                { value: 'percent', label: t('extras.percent') },
                { value: 'amount', label: t('extras.amountXof') },
              ]}
            />
            <InputNumber
              id="ov-discount"
              min={discountType === 'percent' ? 0.01 : 1}
              max={discountType === 'percent' ? 100 : undefined}
              precision={discountType === 'percent' ? 2 : 0}
              value={discount}
              onChange={setDiscount}
            />
          </Form.Item>
        ) : null}
        <Form.Item label={t('extras.note')} htmlFor="ov-note">
          <Input
            id="ov-note"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon role="alert" message={error} /> : null}
    </Modal>
  );
}

/** SA-15 / SA-16: overrides (features, quotas, discounts), add-ons and coupon of a tenant. */
export function ExtrasTab({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation('ten');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const fmt = useFormatDate();
  const can = useAbilities();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [addonId, setAddonId] = useState<string | undefined>();
  const [coupon, setCoupon] = useState('');
  const [couponOk, setCouponOk] = useState(false);
  const addons = useQuery({
    queryKey: ['addons'],
    enabled: can.admin,
    queryFn: () => apiClient.get<{ items: Addon[] }>('/addons'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tenant', tenant.id] });
  const endOverride = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tenants/${tenant.id}/overrides/${id}`),
    onSuccess: refresh,
  });
  const attach = useMutation({
    mutationFn: () => apiClient.post(`/tenants/${tenant.id}/addons`, { addonId }),
    onSuccess: async () => {
      setAddonId(undefined);
      await refresh();
    },
  });
  const detach = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tenants/${tenant.id}/addons/${id}`),
    onSuccess: refresh,
  });
  const redeem = useMutation({
    mutationFn: () => apiClient.post(`/tenants/${tenant.id}/coupons`, { code: coupon.trim() }),
    onSuccess: async () => {
      setCoupon('');
      setCouponOk(true);
      await refresh();
    },
    onMutate: () => setCouponOk(false),
  });
  const failure = [endOverride, attach, detach, redeem].find((m) => m.isError)?.error;

  return (
    <>
      {failure ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorText(failure)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Card
        size="small"
        title={t('extras.overrides')}
        extra={
          can.admin ? (
            <Button size="small" onClick={() => setAdding(true)}>
              {t('extras.addOverride')}
            </Button>
          ) : null
        }
      >
        <Table<TenantOverride>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={tenant.overrides}
          locale={{ emptyText: t('extras.noOverride') }}
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: t('extras.kind'),
              dataIndex: 'kind',
              render: (k: Kind) => t(`extras.kinds.${k}`),
            },
            { title: t('extras.key'), dataIndex: 'key' },
            { title: t('extras.value'), render: (_: unknown, o) => describe(o, (k) => t(k)) },
            {
              title: t('extras.endsAt'),
              dataIndex: 'endsAt',
              render: (d: string | null) => fmt.day(d),
            },
            { title: t('extras.note'), dataIndex: 'note', render: (n: string | null) => n ?? '—' },
            {
              title: tb('status'),
              dataIndex: 'active',
              render: (a: boolean) => (
                <Tag color={a ? 'green' : 'default'}>
                  {a ? t('extras.active') : t('extras.ended')}
                </Tag>
              ),
            },
            ...(can.admin
              ? [
                  {
                    title: tb('actions'),
                    key: 'a',
                    render: (_: unknown, o: TenantOverride) =>
                      o.active ? (
                        <Button
                          size="small"
                          loading={endOverride.isPending && endOverride.variables === o.id}
                          onClick={() => endOverride.mutate(o.id)}
                        >
                          {t('extras.end')}
                        </Button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Card size="small" title={t('extras.addons')} style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={tenant.addons}
          locale={{ emptyText: t('extras.noAddon') }}
          columns={[
            {
              title: t('extras.addon'),
              render: (_: unknown, a: TenantDetail['addons'][number]) => a.addon.name,
            },
            { title: tb('status'), dataIndex: 'status' },
            {
              title: t('extras.startsAt'),
              dataIndex: 'startsAt',
              render: (d: string) => fmt.day(d),
            },
            {
              title: t('extras.endsAt'),
              dataIndex: 'endsAt',
              render: (d: string | null) => fmt.day(d),
            },
            ...(can.admin
              ? [
                  {
                    title: tb('actions'),
                    key: 'a',
                    render: (_: unknown, a: TenantDetail['addons'][number]) =>
                      a.status === 'ACTIVE' ? (
                        <Button size="small" danger onClick={() => detach.mutate(a.id)}>
                          {t('extras.detach')}
                        </Button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
        {can.admin ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select
              aria-label={t('extras.addon')}
              placeholder={t('extras.pickAddon')}
              style={{ minWidth: 240 }}
              value={addonId}
              onChange={setAddonId}
              options={(addons.data?.items ?? [])
                .filter((a) => a.isActive)
                .map((a) => ({ value: a.id, label: a.name }))}
            />
            <Button disabled={!addonId} loading={attach.isPending} onClick={() => attach.mutate()}>
              {t('extras.attach')}
            </Button>
          </div>
        ) : null}
      </Card>

      {can.admin ? (
        <Card size="small" title={t('extras.coupon')} style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input
              aria-label={t('extras.couponCode')}
              placeholder={t('extras.couponCode')}
              style={{ width: 240 }}
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            />
            <Button
              disabled={coupon.trim().length < 2}
              loading={redeem.isPending}
              onClick={() => redeem.mutate()}
            >
              {t('extras.redeem')}
            </Button>
          </div>
          {couponOk ? (
            <Alert
              type="success"
              showIcon
              message={t('extras.redeemed')}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </Card>
      ) : null}
      {adding ? <OverrideModal tenantId={tenant.id} onClose={() => setAdding(false)} /> : null}
    </>
  );
}
