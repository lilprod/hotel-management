import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Switch,
  Tabs,
  message as toast,
} from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { METHODS, useAbilities } from '../../billing/common';
import type { PayMethod } from '../../billing/common';

type Channel = 'EMAIL' | 'SMS' | 'BANNER';
const CHANNELS: Channel[] = ['EMAIL', 'SMS', 'BANNER'];
type ReminderModel =
  'trial_ending' | 'invoice_upcoming' | 'invoice_due' | 'invoice_overdue' | 'account_suspended';

export interface BillingSettings {
  identity: {
    legalName: string;
    legalForm?: string;
    country: string;
    currency: string;
    taxId?: string;
    rccm?: string;
    taxRegime?: string;
    address?: string;
    email?: string;
    phone?: string;
  };
  paymentInstructions: {
    note: string;
    methods: {
      code: PayMethod;
      label: string;
      merchantNumber?: string;
      referenceLabel?: string;
      referencePattern?: string;
    }[];
  };
  graceDays: number;
  suspensionDays: number;
  purgeDays: number;
  paymentTermsDays: number;
  renewalLeadDays: number;
  doubleValidation: boolean;
  smsReminders: boolean;
  vat: { enabled: boolean; rateBps: number; label: string };
  reminders: {
    model: ReminderModel;
    offsetsDays: number[];
    channels: Channel[];
    optionalChannels?: Channel[];
  }[];
}

const blank = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

/** Drops empty optional strings (the API rejects "" for e-mail, etc.) before saving. */
export function cleanSettings(s: BillingSettings): BillingSettings {
  const i = s.identity;
  const identity: BillingSettings['identity'] = {
    legalName: i.legalName.trim(),
    country: i.country.trim().toUpperCase(),
    currency: i.currency.trim().toUpperCase(),
  };
  for (const k of [
    'legalForm',
    'taxId',
    'rccm',
    'taxRegime',
    'address',
    'email',
    'phone',
  ] as const) {
    const v = blank(i[k]);
    if (v) identity[k] = v;
  }
  return {
    ...s,
    identity,
    paymentInstructions: {
      note: s.paymentInstructions.note,
      methods: s.paymentInstructions.methods.map((m) => {
        const out: BillingSettings['paymentInstructions']['methods'][number] = {
          code: m.code,
          label: m.label.trim(),
        };
        for (const k of ['merchantNumber', 'referenceLabel', 'referencePattern'] as const) {
          const v = blank(m[k]);
          if (v) out[k] = v;
        }
        return out;
      }),
    },
  };
}

export function validateSettings(s: BillingSettings): string[] {
  const errors: string[] = [];
  if (!s.identity.legalName.trim()) errors.push('legalName');
  if (!/^[A-Za-z]{2}$/.test(s.identity.country.trim())) errors.push('country');
  if (!/^[A-Za-z]{3}$/.test(s.identity.currency.trim())) errors.push('currency');
  if (s.identity.email?.trim() && !/^\S+@\S+\.\S+$/.test(s.identity.email.trim()))
    errors.push('email');
  for (const m of s.paymentInstructions.methods) {
    if (!m.label.trim()) errors.push('methodLabel');
    if (m.referencePattern?.trim()) {
      try {
        new RegExp(m.referencePattern);
      } catch {
        errors.push('pattern');
      }
    }
  }
  if (s.vat.rateBps < 0 || s.vat.rateBps > 10_000 || !s.vat.label.trim()) errors.push('vat');
  return [...new Set(errors)];
}

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Form.Item label={label} htmlFor={id} extra={hint}>
      <InputNumber
        id={id}
        min={min}
        max={max}
        precision={0}
        disabled={disabled}
        value={value}
        onChange={(v) => v !== null && onChange(v)}
      />
    </Form.Item>
  );
}

/** SA-39: billing settings (identity, payment instructions, grace / suspension / purge, VAT, reminders). */
export function BillingSettingsPage() {
  const { t } = useTranslation('bset');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const can = useAbilities();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['billing-settings'],
    queryFn: () => apiClient.get<BillingSettings>('/billing/settings'),
  });
  const [draft, setDraft] = useState<BillingSettings | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (s: BillingSettings) => apiClient.patch<BillingSettings>('/billing/settings', s),
    onSuccess: async (s) => {
      setDraft(s);
      await qc.invalidateQueries({ queryKey: ['billing-settings'] });
      void toast.success(t('saved'));
    },
  });
  const ro = !can.admin;

  if (q.isError)
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert type="error" showIcon message={message(q.error)} />
      </>
    );
  if (!draft)
    return (
      <>
        <PageHeader title={t('title')} />
        <Skeleton active />
      </>
    );

  const patch = (p: Partial<BillingSettings>) => setDraft({ ...draft, ...p });
  const id = (p: Partial<BillingSettings['identity']>) =>
    patch({ identity: { ...draft.identity, ...p } });
  const methods = draft.paymentInstructions.methods;
  const setMethods = (m: typeof methods) =>
    patch({ paymentInstructions: { ...draft.paymentInstructions, methods: m } });
  const setMethod = (n: number, p: Partial<(typeof methods)[number]>) =>
    setMethods(methods.map((m, k) => (k === n ? { ...m, ...p } : m)));
  const setReminder = (n: number, p: Partial<BillingSettings['reminders'][number]>) =>
    patch({ reminders: draft.reminders.map((r, k) => (k === n ? { ...r, ...p } : r)) });

  const submit = () => {
    const errors = validateSettings(draft);
    setInvalid(errors);
    if (errors.length === 0) save.mutate(cleanSettings(draft));
  };

  const text = (
    key: keyof BillingSettings['identity'],
    label: string,
    opts: { required?: boolean; type?: string } = {},
  ) => (
    <Form.Item label={label} htmlFor={`bs-${key}`} required={opts.required ?? false}>
      <Input
        id={`bs-${key}`}
        type={opts.type ?? 'text'}
        disabled={ro}
        value={draft.identity[key] ?? ''}
        onChange={(e) => id({ [key]: e.target.value })}
      />
    </Form.Item>
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          !ro ? (
            <Button type="primary" loading={save.isPending} onClick={submit}>
              {tb('save')}
            </Button>
          ) : null
        }
      />
      {ro ? (
        <Alert type="info" showIcon message={tb('readOnly')} style={{ marginBottom: 12 }} />
      ) : null}
      {invalid.length > 0 ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          style={{ marginBottom: 12 }}
          message={t('invalid')}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {invalid.map((k) => (
                <li key={k}>{t(`errors.${k}`)}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      {save.isError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={message(save.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Form layout="vertical" component={false}>
        <Tabs
          items={[
            {
              key: 'identity',
              label: t('tabs.identity'),
              children: (
                <Card size="small" style={{ maxWidth: 720 }}>
                  {text('legalName', t('identity.legalName'), { required: true })}
                  {text('legalForm', t('identity.legalForm'))}
                  {text('country', t('identity.country'), { required: true })}
                  {text('currency', t('identity.currency'), { required: true })}
                  {text('taxId', t('identity.taxId'))}
                  {text('rccm', t('identity.rccm'))}
                  {text('taxRegime', t('identity.taxRegime'))}
                  {text('address', t('identity.address'))}
                  {text('email', t('identity.email'), { type: 'email' })}
                  {text('phone', t('identity.phone'))}
                </Card>
              ),
            },
            {
              key: 'payment',
              label: t('tabs.payment'),
              children: (
                <Card size="small" style={{ maxWidth: 820 }}>
                  <Form.Item
                    label={t('payment.note')}
                    htmlFor="bs-note"
                    extra={t('payment.noteHint')}
                  >
                    <Input.TextArea
                      id="bs-note"
                      rows={3}
                      maxLength={2000}
                      disabled={ro}
                      value={draft.paymentInstructions.note}
                      onChange={(e) =>
                        patch({
                          paymentInstructions: {
                            ...draft.paymentInstructions,
                            note: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <h3>{t('payment.methods')}</h3>
                  {methods.map((m, n) => (
                    <Card
                      key={n}
                      size="small"
                      style={{ marginBottom: 12 }}
                      type="inner"
                      title={`${tb(`method.${m.code}`)}`}
                      extra={
                        !ro ? (
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={t('payment.remove')}
                            onClick={() => setMethods(methods.filter((_, k) => k !== n))}
                          />
                        ) : null
                      }
                    >
                      <Form.Item label={t('payment.code')} htmlFor={`bs-m-code-${n}`}>
                        <Select
                          id={`bs-m-code-${n}`}
                          disabled={ro}
                          value={m.code}
                          onChange={(code) => setMethod(n, { code })}
                          options={METHODS.map((c) => ({ value: c, label: tb(`method.${c}`) }))}
                        />
                      </Form.Item>
                      <Form.Item label={t('payment.label')} htmlFor={`bs-m-label-${n}`} required>
                        <Input
                          id={`bs-m-label-${n}`}
                          disabled={ro}
                          value={m.label}
                          onChange={(e) => setMethod(n, { label: e.target.value })}
                        />
                      </Form.Item>
                      <Form.Item label={t('payment.merchantNumber')} htmlFor={`bs-m-num-${n}`}>
                        <Input
                          id={`bs-m-num-${n}`}
                          disabled={ro}
                          value={m.merchantNumber ?? ''}
                          onChange={(e) => setMethod(n, { merchantNumber: e.target.value })}
                        />
                      </Form.Item>
                      <Form.Item label={t('payment.referenceLabel')} htmlFor={`bs-m-rl-${n}`}>
                        <Input
                          id={`bs-m-rl-${n}`}
                          disabled={ro}
                          value={m.referenceLabel ?? ''}
                          onChange={(e) => setMethod(n, { referenceLabel: e.target.value })}
                        />
                      </Form.Item>
                      <Form.Item
                        label={t('payment.referencePattern')}
                        htmlFor={`bs-m-rp-${n}`}
                        extra={t('payment.patternHint')}
                      >
                        <Input
                          id={`bs-m-rp-${n}`}
                          disabled={ro}
                          value={m.referencePattern ?? ''}
                          onChange={(e) => setMethod(n, { referencePattern: e.target.value })}
                        />
                      </Form.Item>
                    </Card>
                  ))}
                  {!ro && methods.length < 10 ? (
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => setMethods([...methods, { code: 'MIXX', label: '' }])}
                    >
                      {t('payment.add')}
                    </Button>
                  ) : null}
                </Card>
              ),
            },
            {
              key: 'lifecycle',
              label: t('tabs.lifecycle'),
              children: (
                <Card size="small" style={{ maxWidth: 720 }}>
                  <NumberField
                    id="bs-grace"
                    label={t('lifecycle.graceDays')}
                    hint={t('lifecycle.graceHint')}
                    min={0}
                    max={60}
                    disabled={ro}
                    value={draft.graceDays}
                    onChange={(v) => patch({ graceDays: v })}
                  />
                  <NumberField
                    id="bs-susp"
                    label={t('lifecycle.suspensionDays')}
                    hint={t('lifecycle.suspensionHint')}
                    min={1}
                    max={730}
                    disabled={ro}
                    value={draft.suspensionDays}
                    onChange={(v) => patch({ suspensionDays: v })}
                  />
                  <NumberField
                    id="bs-purge"
                    label={t('lifecycle.purgeDays')}
                    hint={t('lifecycle.purgeHint')}
                    min={1}
                    max={3650}
                    disabled={ro}
                    value={draft.purgeDays}
                    onChange={(v) => patch({ purgeDays: v })}
                  />
                  <NumberField
                    id="bs-terms"
                    label={t('lifecycle.paymentTermsDays')}
                    hint={t('lifecycle.termsHint')}
                    min={0}
                    max={90}
                    disabled={ro}
                    value={draft.paymentTermsDays}
                    onChange={(v) => patch({ paymentTermsDays: v })}
                  />
                  <NumberField
                    id="bs-lead"
                    label={t('lifecycle.renewalLeadDays')}
                    hint={t('lifecycle.leadHint')}
                    min={0}
                    max={60}
                    disabled={ro}
                    value={draft.renewalLeadDays}
                    onChange={(v) => patch({ renewalLeadDays: v })}
                  />
                  <Form.Item
                    label={t('lifecycle.doubleValidation')}
                    extra={t('lifecycle.doubleHint')}
                  >
                    <Switch
                      aria-label={t('lifecycle.doubleValidation')}
                      disabled={ro}
                      checked={draft.doubleValidation}
                      onChange={(v) => patch({ doubleValidation: v })}
                    />
                  </Form.Item>
                </Card>
              ),
            },
            {
              key: 'vat',
              label: t('tabs.vat'),
              children: (
                <Card size="small" style={{ maxWidth: 720 }}>
                  <Form.Item label={t('vat.enabled')}>
                    <Switch
                      aria-label={t('vat.enabled')}
                      disabled={ro}
                      checked={draft.vat.enabled}
                      onChange={(enabled) => patch({ vat: { ...draft.vat, enabled } })}
                    />
                  </Form.Item>
                  <Form.Item label={t('vat.rate')} htmlFor="bs-vat-rate" extra={t('vat.rateHint')}>
                    <InputNumber
                      id="bs-vat-rate"
                      min={0}
                      max={100}
                      precision={2}
                      suffix="%"
                      disabled={ro}
                      value={draft.vat.rateBps / 100}
                      onChange={(v) =>
                        v !== null && patch({ vat: { ...draft.vat, rateBps: Math.round(v * 100) } })
                      }
                    />
                  </Form.Item>
                  <Form.Item label={t('vat.label')} htmlFor="bs-vat-label">
                    <Input
                      id="bs-vat-label"
                      maxLength={30}
                      disabled={ro}
                      value={draft.vat.label}
                      onChange={(e) => patch({ vat: { ...draft.vat, label: e.target.value } })}
                    />
                  </Form.Item>
                </Card>
              ),
            },
            {
              key: 'reminders',
              label: t('tabs.reminders'),
              children: (
                <Card size="small" style={{ maxWidth: 820 }}>
                  <Form.Item label={t('reminders.sms')} extra={t('reminders.smsHint')}>
                    <Switch
                      aria-label={t('reminders.sms')}
                      disabled={ro}
                      checked={draft.smsReminders}
                      onChange={(v) => patch({ smsReminders: v })}
                    />
                  </Form.Item>
                  {draft.reminders.map((r, n) => (
                    <Card
                      key={r.model}
                      size="small"
                      type="inner"
                      title={t(`reminders.models.${r.model}`)}
                      style={{ marginBottom: 12 }}
                    >
                      <Form.Item
                        label={t('reminders.offsets')}
                        htmlFor={`bs-off-${n}`}
                        extra={t('reminders.offsetsHint')}
                      >
                        <Select
                          id={`bs-off-${n}`}
                          mode="tags"
                          disabled={ro}
                          tokenSeparators={[',', ' ']}
                          value={r.offsetsDays.map(String)}
                          onChange={(vals: string[]) =>
                            setReminder(n, {
                              offsetsDays: vals
                                .map((v) => Number.parseInt(v, 10))
                                .filter((v) => Number.isInteger(v) && v >= -60 && v <= 60),
                            })
                          }
                        />
                      </Form.Item>
                      <Form.Item label={t('reminders.channels')} htmlFor={`bs-ch-${n}`}>
                        <Select
                          id={`bs-ch-${n}`}
                          mode="multiple"
                          disabled={ro}
                          value={r.channels}
                          onChange={(channels: Channel[]) => setReminder(n, { channels })}
                          options={CHANNELS.map((c) => ({
                            value: c,
                            label: t(`reminders.channel.${c}`),
                          }))}
                        />
                      </Form.Item>
                    </Card>
                  ))}
                </Card>
              ),
            },
          ]}
        />
      </Form>
    </>
  );
}
