import { useMutation } from '@tanstack/react-query';
import { Alert, Form, Input, InputNumber, Modal, Radio, Select, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApiError } from '../../auth/useApiError';
import { post } from './api';
import type { Folio, FolioLine, Product } from './api';
import { money, toMinor } from './model';

/** Reason typed for a sensitive action (discount, reversal): 3 characters minimum, like the API. */
export function ReasonModal({
  open,
  title,
  onCancel,
  onSubmit,
  okText,
  danger,
  children,
  extraValid = true,
}: {
  open: boolean;
  title: string;
  okText: string;
  danger?: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
  children?: React.ReactNode;
  extraValid?: boolean;
}) {
  const { t } = useTranslation('billing');
  const toMessage = useApiError();
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      destroyOnHidden
      okText={okText}
      cancelText={t('cancel')}
      okButtonProps={{ danger, disabled: reason.trim().length < 3 || !extraValid, loading: busy }}
      onOk={async () => {
        setBusy(true);
        try {
          await onSubmit(reason.trim());
          setReason('');
          setFailure(null);
        } catch (e) {
          setFailure(toMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {children}
        <Input.TextArea
          aria-label={t('reason')}
          placeholder={t('reason')}
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {failure ? <Alert type="error" showIcon message={failure} /> : null}
      </Space>
    </Modal>
  );
}

export function DiscountDialog({
  folio,
  line,
  onClose,
  onDone,
}: {
  folio: Folio;
  line: FolioLine | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('billing');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState<number | null>(null);
  return (
    <ReasonModal
      open={!!line}
      title={t('discount.title', { label: line?.label ?? '' })}
      okText={t('discount.apply')}
      onCancel={onClose}
      extraValid={!!value && value > 0}
      onSubmit={async (reason) => {
        await post(`/folios/${folio.id}/discounts`, {
          lineId: line!.id,
          reason,
          ...(kind === 'percent' ? { percent: value } : { amount: toMinor(value, folio.currency) }),
        });
        setValue(null);
        onDone();
      }}
    >
      <Radio.Group
        value={kind}
        onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}
        options={[
          { value: 'percent', label: t('discount.percent') },
          { value: 'amount', label: t('discount.amount', { currency: folio.currency }) },
        ]}
      />
      <InputNumber
        aria-label={t('discount.value')}
        min={0}
        max={kind === 'percent' ? 100 : undefined}
        value={value}
        onChange={setValue}
        style={{ width: '100%' }}
        addonAfter={kind === 'percent' ? '%' : folio.currency}
      />
      {line ? (
        <span>{t('discount.on', { amount: money(line.amount, folio.currency) })}</span>
      ) : null}
    </ReasonModal>
  );
}

/** Extra / product charge: product picker (qty x price, product tax) or manual line with a department. */
export function ChargeDialog({
  folio,
  open,
  products,
  departments,
  onClose,
  onDone,
}: {
  folio: Folio;
  open: boolean;
  products: Product[];
  departments: { code: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('billing');
  const toMessage = useApiError();
  const [mode, setMode] = useState<'product' | 'manual'>(products.length ? 'product' : 'manual');
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [dept, setDept] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const post1 = useMutation({
    mutationFn: () =>
      post(`/folios/${folio.id}/charges`, {
        qty,
        ...(mode === 'product'
          ? { productId }
          : {
              label: label.trim(),
              amount: toMinor(amount, folio.currency),
              ...(dept ? { departmentCode: dept } : {}),
            }),
      }),
    onSuccess: () => {
      setFailure(null);
      setProductId(null);
      setLabel('');
      setAmount(null);
      setQty(1);
      onDone();
    },
    onError: (e) => setFailure(toMessage(e)),
  });
  const valid =
    mode === 'product' ? !!productId : label.trim().length > 0 && !!amount && amount > 0 && !!dept;
  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      title={t('charge.title')}
      okText={t('charge.add')}
      cancelText={t('cancel')}
      okButtonProps={{ disabled: !valid, loading: post1.isPending }}
      onOk={() => post1.mutate()}
    >
      <Form layout="vertical">
        <Radio.Group
          style={{ marginBottom: 12 }}
          value={mode}
          onChange={(e) => setMode(e.target.value as 'product' | 'manual')}
          options={[
            { value: 'product', label: t('charge.product'), disabled: products.length === 0 },
            { value: 'manual', label: t('charge.manual') },
          ]}
        />
        {mode === 'product' ? (
          <Form.Item label={t('charge.product')}>
            <Select
              showSearch
              optionFilterProp="label"
              aria-label={t('charge.product')}
              value={productId ?? undefined}
              onChange={setProductId}
              options={products
                .filter((p) => p.isActive)
                .map((p) => ({ value: p.id, label: `${p.name} - ${money(p.price, p.currency)}` }))}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item label={t('folio.label')}>
              <Input
                aria-label={t('folio.label')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={200}
              />
            </Form.Item>
            <Form.Item label={t('charge.unitAmount', { currency: folio.currency })}>
              <InputNumber
                aria-label={t('charge.unitAmount', { currency: folio.currency })}
                min={0}
                style={{ width: '100%' }}
                value={amount}
                onChange={setAmount}
                precision={folio.currency === 'XOF' ? 0 : 2}
              />
            </Form.Item>
            <Form.Item label={t('charge.department')}>
              <Select
                showSearch
                optionFilterProp="label"
                aria-label={t('charge.department')}
                value={dept || undefined}
                onChange={setDept}
                options={departments.map((d) => ({ value: d.code, label: d.name }))}
              />
            </Form.Item>
          </>
        )}
        <Form.Item label={t('charge.qty')}>
          <InputNumber
            aria-label={t('charge.qty')}
            min={0.001}
            max={10000}
            value={qty}
            onChange={(v) => setQty(v ?? 1)}
          />
        </Form.Item>
      </Form>
      {failure ? <Alert type="error" showIcon message={failure} /> : null}
    </Modal>
  );
}
