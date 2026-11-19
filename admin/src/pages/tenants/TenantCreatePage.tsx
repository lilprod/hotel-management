import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Select, Steps } from 'antd';
import { useState } from 'react';
import { Controller, useForm, type FieldPath, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { Field, a11y, bind } from '../../components/Field';
import { CYCLES } from '../../billing/common';
import { usePlans } from './TenantsPage';

const schema = z.object({
  name: z.string().trim().min(2, 'ten:validation.name').max(150),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, 'ten:validation.slug'),
  legalName: z.string().trim().max(200).optional(),
  country: z.string().regex(/^[A-Z]{2}$/, 'ten:validation.country'),
  timezone: z.string().min(1, 'ten:validation.timezone'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ten:validation.currency'),
  locale: z.enum(['fr', 'en']),
  email: z.union([z.literal(''), z.email('validation.emailInvalid')]).optional(),
  phone: z.string().max(40).optional(),
  planId: z.string().min(1, 'ten:validation.plan'),
  billingCycle: z.enum(CYCLES),
  trialDays: z.number().int().min(0).max(365).optional(),
  owner: z.object({
    name: z.string().trim().min(1, 'validation.required'),
    email: z.email('validation.emailInvalid'),
    phone: z.string().max(40).optional(),
  }),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
  notes: z.string().max(5000).optional(),
});
type Values = z.infer<typeof schema>;

const STEP_FIELDS: FieldPath<Values>[][] = [
  ['name', 'slug', 'legalName', 'country', 'timezone', 'currency', 'locale', 'email', 'phone'],
  ['planId', 'billingCycle', 'trialDays'],
  ['owner.name', 'owner.email', 'owner.phone', 'tags', 'notes'],
  [],
];

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/** SA-23: manual tenant creation wizard (establishment, offer, owner invitation, summary). */
export function TenantCreatePage() {
  const { t } = useTranslation('ten');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const plans = usePlans();
  const [step, setStep] = useState(0);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema) as Resolver<Values>,
    defaultValues: {
      name: '',
      slug: '',
      legalName: '',
      country: 'TG',
      timezone: 'Africa/Lome',
      currency: 'XOF',
      locale: 'fr',
      email: '',
      phone: '',
      planId: '',
      billingCycle: 'MONTHLY',
      owner: { name: '', email: '', phone: '' },
      tags: [],
      notes: '',
    },
  });
  const errors = form.formState.errors;
  const values = form.watch();
  const plan = plans.data?.items.find((p) => p.id === values.planId);

  const next = async () => {
    if (await form.trigger(STEP_FIELDS[step])) setStep(step + 1);
  };

  const create = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await apiClient.post<{ tenantId: string }>('/tenants', {
        name: v.name,
        slug: v.slug,
        ...(v.legalName?.trim() ? { legalName: v.legalName.trim() } : {}),
        country: v.country,
        timezone: v.timezone,
        currency: v.currency,
        locale: v.locale,
        ...(v.email ? { email: v.email } : {}),
        ...(v.phone?.trim() ? { phone: v.phone.trim() } : {}),
        planId: v.planId,
        billingCycle: v.billingCycle,
        ...(v.trialDays !== undefined ? { trialDays: v.trialDays } : {}),
        owner: {
          name: v.owner.name,
          email: v.owner.email,
          ...(v.owner.phone?.trim() ? { phone: v.owner.phone.trim() } : {}),
        },
        tags: v.tags,
        ...(v.notes?.trim() ? { notes: v.notes.trim() } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['tenants'] });
      navigate(`/tenants/${r.tenantId}`);
    } catch (e) {
      setError(message(e));
    }
  });

  return (
    <>
      <PageHeader
        title={t('create')}
        subtitle={t('createSubtitle')}
        breadcrumb={[{ title: <Link to="/tenants">{t('title')}</Link> }, { title: t('create') }]}
      />
      <Steps
        current={step}
        size="small"
        style={{ maxWidth: 960, marginBottom: 24 }}
        items={[t('wizard.tenant'), t('wizard.offer'), t('wizard.owner'), t('wizard.summary')].map(
          (title) => ({ title }),
        )}
      />
      <form
        noValidate
        aria-label={t('create')}
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 3) void next();
          else void create(e);
        }}
      >
        <Form layout="vertical" component={false}>
          <Card size="small" style={{ maxWidth: 960 }}>
            <div hidden={step !== 0}>
              <Field id="tc-name" label={t('wizard.name')} required error={errors.name?.message}>
                <Input
                  {...a11y('tc-name', errors.name)}
                  {...bind(
                    form.register('name', {
                      onChange: (e: { target: { value: string } }) => {
                        if (!slugTouched) form.setValue('slug', slugify(e.target.value));
                      },
                    }),
                  )}
                />
              </Field>
              <Field
                id="tc-slug"
                label={t('wizard.slug')}
                required
                extra={t('wizard.slugHint')}
                error={errors.slug?.message}
              >
                <Input
                  {...a11y('tc-slug', errors.slug)}
                  {...bind(form.register('slug', { onChange: () => setSlugTouched(true) }))}
                />
              </Field>
              <Field id="tc-legal" label={t('legalName')}>
                <Input {...a11y('tc-legal')} {...bind(form.register('legalName'))} />
              </Field>
              <Field id="tc-country" label={t('country')} required error={errors.country?.message}>
                <Input
                  {...a11y('tc-country', errors.country)}
                  maxLength={2}
                  style={{ width: 100 }}
                  {...bind(form.register('country'))}
                />
              </Field>
              <Field id="tc-tz" label={t('timezone')} required error={errors.timezone?.message}>
                <Input {...a11y('tc-tz', errors.timezone)} {...bind(form.register('timezone'))} />
              </Field>
              <Field
                id="tc-currency"
                label={t('wizard.currency')}
                required
                error={errors.currency?.message}
              >
                <Input
                  {...a11y('tc-currency', errors.currency)}
                  maxLength={3}
                  style={{ width: 100 }}
                  {...bind(form.register('currency'))}
                />
              </Field>
              <Field id="tc-locale" label={t('wizard.locale')}>
                <Controller
                  control={form.control}
                  name="locale"
                  render={({ field }) => (
                    <Select
                      id="tc-locale"
                      value={field.value}
                      onChange={field.onChange}
                      style={{ width: 160 }}
                      options={[
                        { value: 'fr', label: 'Français' },
                        { value: 'en', label: 'English' },
                      ]}
                    />
                  )}
                />
              </Field>
              <Field id="tc-email" label="E-mail" error={errors.email?.message}>
                <Input
                  {...a11y('tc-email', errors.email)}
                  type="email"
                  {...bind(form.register('email'))}
                />
              </Field>
              <Field id="tc-phone" label={t('phone')}>
                <Input {...a11y('tc-phone')} {...bind(form.register('phone'))} />
              </Field>
            </div>

            <div hidden={step !== 1}>
              <Field id="tc-plan" label={t('plan')} required error={errors.planId?.message}>
                <Controller
                  control={form.control}
                  name="planId"
                  render={({ field }) => (
                    <Select
                      id="tc-plan"
                      value={field.value || undefined}
                      onChange={field.onChange}
                      options={(plans.data?.items ?? [])
                        .filter((p) => p.isActive)
                        .map((p) => ({ value: p.id, label: p.name }))}
                    />
                  )}
                />
              </Field>
              <Field id="tc-cycle" label={t('cycle')}>
                <Controller
                  control={form.control}
                  name="billingCycle"
                  render={({ field }) => (
                    <Select
                      id="tc-cycle"
                      value={field.value}
                      onChange={field.onChange}
                      options={CYCLES.map((c) => ({ value: c, label: tb(`cycle.${c}`) }))}
                    />
                  )}
                />
              </Field>
              <Field
                id="tc-trial"
                label={t('wizard.trialDays')}
                extra={plan ? t('wizard.trialHint', { days: plan.trialDays }) : undefined}
                error={errors.trialDays?.message}
              >
                <Controller
                  control={form.control}
                  name="trialDays"
                  render={({ field }) => (
                    <InputNumber
                      id="tc-trial"
                      min={0}
                      max={365}
                      precision={0}
                      value={field.value ?? null}
                      onChange={(v) => field.onChange(v ?? undefined)}
                    />
                  )}
                />
              </Field>
            </div>

            <div hidden={step !== 2}>
              <Field
                id="tc-owner-name"
                label={t('wizard.ownerName')}
                required
                error={errors.owner?.name?.message}
              >
                <Input
                  {...a11y('tc-owner-name', errors.owner?.name)}
                  {...bind(form.register('owner.name'))}
                />
              </Field>
              <Field
                id="tc-owner-email"
                label={t('wizard.ownerEmail')}
                required
                extra={t('wizard.ownerHint')}
                error={errors.owner?.email?.message}
              >
                <Input
                  {...a11y('tc-owner-email', errors.owner?.email)}
                  type="email"
                  {...bind(form.register('owner.email'))}
                />
              </Field>
              <Field id="tc-owner-phone" label={t('wizard.ownerPhone')}>
                <Input {...a11y('tc-owner-phone')} {...bind(form.register('owner.phone'))} />
              </Field>
              <Field id="tc-tags" label={t('tags')}>
                <Controller
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <Select
                      id="tc-tags"
                      mode="tags"
                      value={field.value}
                      onChange={field.onChange}
                      tokenSeparators={[',']}
                    />
                  )}
                />
              </Field>
              <Field id="tc-notes" label={t('notes')}>
                <Controller
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <Input.TextArea
                      id="tc-notes"
                      rows={3}
                      maxLength={5000}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                    />
                  )}
                />
              </Field>
            </div>

            {step === 3 ? (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label={t('wizard.name')}>{values.name}</Descriptions.Item>
                <Descriptions.Item label={t('wizard.slug')}>{values.slug}</Descriptions.Item>
                <Descriptions.Item label={t('plan')}>
                  {plan?.name ?? '—'} · {tb(`cycle.${values.billingCycle}`)}
                </Descriptions.Item>
                <Descriptions.Item label={t('wizard.trialDays')}>
                  {values.trialDays ?? plan?.trialDays ?? 0}
                </Descriptions.Item>
                <Descriptions.Item label={t('wizard.owner')}>
                  {values.owner.name} ({values.owner.email})
                </Descriptions.Item>
                <Descriptions.Item label={t('wizard.currency')}>
                  {values.currency} · {values.country} · {values.timezone}
                </Descriptions.Item>
              </Descriptions>
            ) : null}
          </Card>
          {error ? (
            <Alert
              type="error"
              showIcon
              role="alert"
              message={error}
              style={{ maxWidth: 960, marginTop: 16 }}
            />
          ) : null}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            {step > 0 ? <Button onClick={() => setStep(step - 1)}>{tb('back')}</Button> : null}
            {step < 3 ? (
              <Button type="primary" onClick={() => void next()}>
                {t('wizard.next')}
              </Button>
            ) : (
              <Button type="primary" htmlType="submit" loading={form.formState.isSubmitting}>
                {t('wizard.create')}
              </Button>
            )}
          </div>
        </Form>
      </form>
    </>
  );
}
