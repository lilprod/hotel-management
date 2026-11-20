import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Form, Input, Radio, Select, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '@hm/ui';

import { money } from '../billing/common';
import { Field, a11y, bind } from '../components/Field';
import {
  CYCLES,
  SLUG_RE,
  fetchPlans,
  slugify,
  submitSignup,
  useSlugAvailability,
  type Cycle,
  type SlugState,
} from './api';
import { SignupLayout } from './SignupLayout';

export const COUNTRIES = ['TG', 'BJ', 'CI', 'SN', 'BF', 'ML', 'NE'] as const;

const classes = (pw: string) =>
  [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;

// Messages are i18n keys (namespace `signup`), translated by <Field>.
export const signupSchema = z.object({
  hotelName: z.string().trim().min(2, 'signup:form.errors.hotelName').max(150),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, 'signup:form.errors.slug')
    .refine((s) => !s.includes('--'), 'signup:form.errors.slug'),
  ownerName: z.string().trim().min(2, 'signup:form.errors.ownerName').max(150),
  email: z.string().trim().email('signup:form.errors.email').max(254),
  phone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, '').length >= 8, 'signup:form.errors.phone'),
  country: z.enum(COUNTRIES),
  city: z.string().trim().min(1, 'signup:form.errors.city').max(100),
  planCode: z.string().min(1, 'signup:form.errors.plan'),
  cycle: z.enum(CYCLES),
  password: z
    .string()
    .min(10, 'signup:form.errors.passwordMin')
    .refine((v) => classes(v) >= 3, 'signup:form.errors.passwordClasses'),
  acceptTerms: z.literal(true, { error: 'signup:form.errors.terms' }),
  acceptDpa: z.literal(true, { error: 'signup:form.errors.dpa' }),
  website: z.string().optional(),
});
export type SignupValues = z.infer<typeof signupSchema>;

function SlugStatus({ state, host }: { state: SlugState; host: string }) {
  const { t } = useTranslation('signup');
  if (state.kind === 'idle') return <span>{t('form.slugHint')}</span>;
  if (state.kind === 'checking') return <span role="status">{t('form.slugChecking')}</span>;
  if (state.kind === 'available')
    return (
      <span role="status" style={{ color: 'var(--ant-color-success, #389e0d)' }}>
        {t('form.slugAvailable', { host })}
      </span>
    );
  if (state.kind === 'unavailable')
    return (
      <span role="alert" style={{ color: 'var(--ant-color-error, #cf1322)' }}>
        {t(`form.slug${state.reason}`)}
      </span>
    );
  return <span role="status">{t('form.slugUnknown')}</span>;
}

export const platformHost = () => window.location.host.replace(/^www\./, '');

/** Signup form: hotel, owner, plan, password, consents; live sub-domain check; honeypot. */
export function SignupFormPage() {
  const { t, i18n } = useTranslation(['signup', 'common', 'errors']);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slugTouched = useRef(false);
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: fetchPlans,
    staleTime: 5 * 60_000,
  });
  const initialCycle = CYCLES.includes(params.get('cycle') as Cycle)
    ? (params.get('cycle') as Cycle)
    : 'MONTHLY';

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    mode: 'onTouched',
    defaultValues: {
      hotelName: '',
      slug: '',
      ownerName: '',
      email: '',
      phone: '',
      country: 'TG',
      city: '',
      planCode: params.get('plan') ?? '',
      cycle: initialCycle,
      password: '',
      acceptTerms: undefined as unknown as true,
      acceptDpa: undefined as unknown as true,
      website: '',
    },
  });
  const { control, register, setValue, setError, watch, formState } = form;
  const { errors } = formState;
  const slug = watch('slug');
  const hotelName = watch('hotelName');
  const planCode = watch('planCode');
  const slugState = useSlugAvailability(slug);
  const items = useMemo(() => plans.data?.items ?? [], [plans.data]);
  const plan = items.find((p) => p.code === planCode);

  // Default plan: the first one offered, when none was chosen on the landing page.
  useEffect(() => {
    if (!planCode && items[0]) setValue('planCode', items[0].code);
  }, [planCode, items, setValue]);

  // Suggest the web address from the hotel name until the user edits it.
  useEffect(() => {
    if (!slugTouched.current) setValue('slug', slugify(hotelName), { shouldValidate: false });
  }, [hotelName, setValue]);

  const host = `${slug || '…'}.${platformHost()}`;
  const slugBlocked = slugState.kind === 'unavailable';

  const submit = form.handleSubmit(async (v) => {
    if (slugBlocked) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = await submitSignup({
        hotelName: v.hotelName,
        slug: v.slug,
        ownerName: v.ownerName,
        email: v.email,
        phone: v.phone,
        country: v.country,
        city: v.city,
        planCode: v.planCode,
        cycle: v.cycle,
        password: v.password,
        acceptTerms: true,
        acceptDpa: true,
        locale: i18n.language === 'en' ? 'en' : 'fr',
        ...(v.website ? { website: v.website } : {}),
      });
      navigate('/signup/check-email', {
        replace: true,
        state: { email: r.email, host: r.host, slug: v.slug },
      });
    } catch (e) {
      if (e instanceof ApiError) {
        const known = new Set(Object.keys(signupSchema.shape));
        let mapped = false;
        for (const issue of e.errors) {
          const path = issue.path as keyof SignupValues;
          if (!known.has(path)) continue;
          const keys = [
            ...(issue.code
              ? [`signup:form.errors.${issue.code}`, `errors:password.${issue.code}`]
              : []),
          ].filter((k) => i18n.exists(k));
          setError(path, { message: keys[0] ?? 'signup:form.errors.server' });
          mapped = true;
        }
        if (e.reason === 'SLUG_TAKEN') {
          setError('slug', { message: 'signup:form.errors.SLUG_TAKEN' });
          mapped = true;
        }
        setServerError(
          mapped
            ? t('signup:form.errors.server')
            : e.code === 'RATE_LIMITED'
              ? t('signup:form.errors.RATE_LIMITED')
              : t(['errors:code.' + (e.code ?? ''), 'errors:generic']),
        );
      } else setServerError(t('errors:network'));
    } finally {
      setBusy(false);
    }
  });

  return (
    <SignupLayout>
      <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 24 }}>
        <Link to="/signup">{t('signup:form.back')}</Link>
        <Card style={{ marginTop: 12 }}>
          <Typography.Title level={1} style={{ fontSize: 26, marginBottom: 4 }}>
            {t('signup:form.title')}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{t('signup:form.subtitle')}</Typography.Paragraph>
          {serverError ? (
            <Alert
              role="alert"
              type="error"
              showIcon
              message={serverError}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Form layout="vertical" onFinish={() => void submit()} noValidate>
            <Typography.Title level={5}>{t('signup:form.sections.hotel')}</Typography.Title>
            <Field
              id="hotelName"
              label={t('signup:form.hotelName')}
              error={errors.hotelName?.message}
              required
            >
              <Input
                {...a11y('hotelName', errors.hotelName)}
                {...bind(register('hotelName'))}
                autoComplete="organization"
              />
            </Field>
            <Field
              id="slug"
              label={t('signup:form.slug')}
              error={errors.slug?.message}
              extra={<SlugStatus state={slugState} host={host} />}
              required
            >
              <Controller
                name="slug"
                control={control}
                render={({ field }) => (
                  <Input
                    {...a11y('slug', errors.slug ?? (slugBlocked ? true : undefined))}
                    name={field.name}
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={(e) => {
                      slugTouched.current = true;
                      field.onChange(e.target.value.toLowerCase());
                    }}
                    addonAfter={`.${platformHost()}`}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                )}
              />
            </Field>
            <Field id="city" label={t('signup:form.city')} error={errors.city?.message} required>
              <Input
                {...a11y('city', errors.city)}
                {...bind(register('city'))}
                autoComplete="address-level2"
              />
            </Field>
            <Field id="country" label={t('signup:form.country')}>
              <Controller
                name="country"
                control={control}
                render={({ field }) => (
                  <Select
                    id="country"
                    value={field.value}
                    onChange={field.onChange}
                    options={COUNTRIES.map((c) => ({
                      value: c,
                      label: new Intl.DisplayNames([i18n.language], { type: 'region' }).of(c) ?? c,
                    }))}
                  />
                )}
              />
            </Field>

            <Typography.Title level={5}>{t('signup:form.sections.owner')}</Typography.Title>
            <Field
              id="ownerName"
              label={t('signup:form.ownerName')}
              error={errors.ownerName?.message}
              required
            >
              <Input
                {...a11y('ownerName', errors.ownerName)}
                {...bind(register('ownerName'))}
                autoComplete="name"
              />
            </Field>
            <Field id="email" label={t('signup:form.email')} error={errors.email?.message} required>
              <Input
                type="email"
                {...a11y('email', errors.email)}
                {...bind(register('email'))}
                autoComplete="email"
              />
            </Field>
            <Field
              id="phone"
              label={t('signup:form.phone')}
              error={errors.phone?.message}
              extra={t('signup:form.phoneHint')}
              required
            >
              <Input
                type="tel"
                {...a11y('phone', errors.phone)}
                {...bind(register('phone'))}
                autoComplete="tel"
              />
            </Field>

            <Typography.Title level={5}>{t('signup:form.sections.plan')}</Typography.Title>
            <Field
              id="planCode"
              label={t('signup:form.planLabel')}
              error={errors.planCode?.message}
              required
            >
              <Controller
                name="planCode"
                control={control}
                render={({ field }) => (
                  <Select
                    id="planCode"
                    value={field.value || undefined}
                    onChange={field.onChange}
                    loading={plans.isLoading}
                    options={items.map((p) => ({ value: p.code, label: p.name }))}
                  />
                )}
              />
            </Field>
            <Field id="cycle" label={t('signup:form.cycleLabel')}>
              <Controller
                name="cycle"
                control={control}
                render={({ field }) => (
                  <Radio.Group
                    id="cycle"
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                    options={CYCLES.map((c) => {
                      const p = plan?.prices.find((x) => x.billingCycle === c);
                      return {
                        value: c,
                        label: p
                          ? `${t(`signup:cycle.${c}`)} · ${money(p.amount, p.currency)}`
                          : t(`signup:cycle.${c}`),
                      };
                    })}
                  />
                )}
              />
            </Field>
            {plan && plan.trialDays > 0 ? (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('signup:form.trialInfo', { count: plan.trialDays })}
              />
            ) : null}

            <Typography.Title level={5}>{t('signup:form.sections.security')}</Typography.Title>
            <Field
              id="password"
              label={t('signup:form.password')}
              error={errors.password?.message}
              extra={t('signup:form.passwordHint')}
              required
            >
              <Input.Password
                {...a11y('password', errors.password)}
                {...bind(register('password'))}
                autoComplete="new-password"
              />
            </Field>
            <Form.Item
              validateStatus={errors.acceptTerms ? 'error' : ''}
              help={
                errors.acceptTerms ? (
                  <span role="alert">{t(errors.acceptTerms.message ?? '')}</span>
                ) : undefined
              }
            >
              <Controller
                name="acceptTerms"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    checked={field.value === true}
                    onChange={(e) => field.onChange(e.target.checked ? true : undefined)}
                  >
                    {t('signup:form.acceptTerms')}
                  </Checkbox>
                )}
              />
            </Form.Item>
            <Form.Item
              validateStatus={errors.acceptDpa ? 'error' : ''}
              help={
                errors.acceptDpa ? (
                  <span role="alert">{t(errors.acceptDpa.message ?? '')}</span>
                ) : undefined
              }
            >
              <Controller
                name="acceptDpa"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    checked={field.value === true}
                    onChange={(e) => field.onChange(e.target.checked ? true : undefined)}
                  >
                    {t('signup:form.acceptDpa')}
                  </Checkbox>
                )}
              />
            </Form.Item>

            {/* Honeypot: invisible to people and assistive tech, bots fill it. */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: -10_000,
                top: 'auto',
                width: 1,
                height: 1,
                overflow: 'hidden',
              }}
            >
              <label htmlFor="website">{t('signup:form.honeypot')}</label>
              <input
                id="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                {...register('website')}
              />
            </div>

            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={busy}
              disabled={slugBlocked}
            >
              {busy ? t('signup:form.submitting') : t('signup:form.submit')}
            </Button>
          </Form>
        </Card>
      </div>
    </SignupLayout>
  );
}
