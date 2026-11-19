import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
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
import { money, useAbilities, useFormatDate } from '../../billing/common';
import type { Coupon } from '../../billing/models';
import { usePlans } from '../tenants/TenantsPage';

const TYPES = ['PERCENT', 'AMOUNT', 'FREE_MONTHS'] as const;

/** Human value of a coupon (percent, amount in XOF or free months). */
export function couponValue(c: Pick<Coupon, 'type' | 'value'>, months: string): string {
  if (c.type === 'PERCENT') return `${c.value} %`;
  if (c.type === 'AMOUNT') return money(Number(c.value));
  return `${c.value} ${months}`;
}

function CouponModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const qc = useQueryClient();
  const plans = usePlans();
  const [code, setCode] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('PERCENT');
  const [value, setValue] = useState<number | null>(null);
  const [forever, setForever] = useState(false);
  const [duration, setDuration] = useState<number | null>(1);
  const [max, setMax] = useState<number | null>(null);
  const [eligible, setEligible] = useState<string[]>([]);
  const [expires, setExpires] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiClient.post('/coupons', {
        code: code.trim().toUpperCase(),
        type,
        value: String(value),
        duration: forever ? null : (duration ?? 1),
        maxRedemptions: max,
        eligiblePlans: eligible,
        expiresAt: expires ? `${expires}T23:59:59+00:00` : null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['coupons'] });
      onClose();
    },
  });
  const valid = /^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code.trim()) && (value ?? 0) > 0;
  return (
    <Modal
      open
      title={t('couponCreate')}
      okText={tb('save')}
      cancelText={tb('cancel')}
      okButtonProps={{ disabled: !valid }}
      confirmLoading={create.isPending}
      onOk={() => create.mutate()}
      onCancel={onClose}
    >
      <Form layout="vertical" component={false}>
        <Form.Item label={t('code')} htmlFor="cp-code" extra={t('codeHint')} required>
          <Input
            id="cp-code"
            value={code}
            maxLength={40}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Form.Item>
        <Form.Item label={t('couponType')} htmlFor="cp-type">
          <Select
            id="cp-type"
            value={type}
            onChange={setType}
            options={TYPES.map((x) => ({ value: x, label: t(`couponTypes.${x}`) }))}
          />
        </Form.Item>
        <Form.Item label={t(`couponValue.${type}`)} htmlFor="cp-value" required>
          <InputNumber
            id="cp-value"
            min={type === 'PERCENT' ? 0.01 : 1}
            max={type === 'PERCENT' ? 100 : undefined}
            precision={type === 'PERCENT' ? 2 : 0}
            value={value}
            onChange={setValue}
          />
        </Form.Item>
        <Form.Item label={t('couponDuration')} extra={t('couponDurationHint')}>
          <Checkbox checked={forever} onChange={(e) => setForever(e.target.checked)}>
            {t('forever')}
          </Checkbox>
          {!forever ? (
            <InputNumber
              aria-label={t('couponDuration')}
              style={{ marginLeft: 12 }}
              min={1}
              max={120}
              precision={0}
              value={duration}
              onChange={setDuration}
            />
          ) : null}
        </Form.Item>
        <Form.Item label={t('maxRedemptions')} htmlFor="cp-max" extra={t('maxHint')}>
          <InputNumber id="cp-max" min={1} precision={0} value={max} onChange={setMax} />
        </Form.Item>
        <Form.Item label={t('eligiblePlans')} htmlFor="cp-plans" extra={t('eligibleHint')}>
          <Select
            id="cp-plans"
            mode="multiple"
            value={eligible}
            onChange={setEligible}
            options={(plans.data?.items ?? []).map((p) => ({ value: p.code, label: p.name }))}
          />
        </Form.Item>
        <Form.Item label={t('expiresAt')} htmlFor="cp-expires">
          <Input
            id="cp-expires"
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            style={{ width: 180 }}
          />
        </Form.Item>
      </Form>
      {create.isError ? (
        <Alert type="error" showIcon role="alert" message={errorText(create.error)} />
      ) : null}
    </Modal>
  );
}

/** SA-13: coupons (percent, fixed amount or free months). */
export function CouponsTab() {
  const { t } = useTranslation('plan');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const can = useAbilities();
  const fmt = useFormatDate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['coupons'],
    queryFn: () => apiClient.get<{ items: Coupon[] }>('/coupons'),
  });
  const toggle = useMutation({
    mutationFn: (c: Coupon) => apiClient.patch(`/coupons/${c.id}`, { isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });
  return (
    <>
      {can.admin ? (
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('couponCreate')}
          </Button>
        </div>
      ) : null}
      {q.isError || toggle.isError ? (
        <Alert
          type="error"
          showIcon
          message={message(q.error ?? toggle.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Table<Coupon>
        rowKey="id"
        loading={q.isPending}
        dataSource={q.data?.items ?? []}
        pagination={false}
        locale={{ emptyText: t('noCoupon') }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: t('code'), dataIndex: 'code' },
          {
            title: t('couponType'),
            dataIndex: 'type',
            render: (x: Coupon['type']) => t(`couponTypes.${x}`),
          },
          { title: t('value'), render: (_: unknown, c) => couponValue(c, t('months')) },
          {
            title: t('couponDuration'),
            dataIndex: 'duration',
            render: (d: number | null) => (d === null ? t('forever') : d),
          },
          {
            title: t('redemptions'),
            render: (_: unknown, c) =>
              `${c.redeemedCount}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}`,
          },
          {
            title: t('eligiblePlans'),
            dataIndex: 'eligiblePlans',
            render: (p: string[]) =>
              p.length ? p.map((x) => <Tag key={x}>{x}</Tag>) : t('allPlans'),
          },
          {
            title: t('expiresAt'),
            dataIndex: 'expiresAt',
            render: (d: string | null) => fmt.day(d),
          },
          {
            title: tb('status'),
            key: 's',
            render: (_: unknown, c) =>
              can.admin ? (
                <Switch
                  checked={c.isActive}
                  loading={toggle.isPending && toggle.variables?.id === c.id}
                  aria-label={`${t('active')} ${c.code}`}
                  onChange={() => toggle.mutate(c)}
                />
              ) : (
                <Tag color={c.isActive ? 'green' : 'default'}>
                  {c.isActive ? t('active') : t('inactive')}
                </Tag>
              ),
          },
        ]}
      />
      {creating ? <CouponModal onClose={() => setCreating(false)} /> : null}
    </>
  );
}
