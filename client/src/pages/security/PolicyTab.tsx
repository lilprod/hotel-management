import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, InputNumber, Select, Spin, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { Field, a11y } from '../../components/Field';
import type { Role, SecurityPolicy } from './api';

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
/** Single address or CIDR range (`10.0.0.0/8`, `2001:db8::/32`), mirrors the server check. */
export function isValidCidr(value: string): boolean {
  const [addr, bits, extra] = value.trim().split('/');
  if (extra !== undefined || !addr) return false;
  const v4 = IPV4.test(addr) && addr.split('.').every((o) => Number(o) <= 255);
  const v6 = !v4 && addr.includes(':') && /^[0-9a-f:.]+$/i.test(addr);
  if (!v4 && !v6) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (v4 ? 32 : 128);
}

const int = (min: number, max: number) =>
  z
    .number({ error: 'validation.required' })
    .int()
    .min(min, 'validation.range')
    .max(max, 'validation.range');

export const policySchema = z.object({
  pwdMinLength: int(8, 128),
  pwdRequireClasses: int(1, 4),
  pwdExpiryDays: int(1, 3650).nullable(),
  pwdHistory: int(0, 24),
  mfaMode: z.enum(['OFF', 'OPTIONAL', 'REQUIRED_FOR_ROLES', 'REQUIRED_ALL']),
  mfaRoles: z.array(z.string()),
  sessionIdleMinutes: int(5, 1440),
  maxSessions: int(1, 100).nullable(),
  lockoutThreshold: int(3, 20),
  lockoutMinutes: int(1, 1440),
  ipAllowlist: z.array(z.string().refine(isValidCidr, 'validation.ipInvalid')).max(50),
  allowImpersonation: z.boolean(),
});
type PolicyValues = z.infer<typeof policySchema>;

/** Tenant security policy (TN-12…TN-18). IP allowlist needs `security.ip_restriction`. */
export function PolicyTab() {
  const { t } = useTranslation('security');
  const message = useApiError();
  const { can, has } = useCan();
  const qc = useQueryClient();
  const editable = can('security.manage');
  const ipRestriction = has('security.ip_restriction');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const policy = useQuery({
    queryKey: ['iam-policy'],
    queryFn: () => apiClient.get<SecurityPolicy>('/iam/security-policy'),
  });
  const roles = useQuery({
    queryKey: ['iam-roles'],
    queryFn: () => apiClient.get<{ items: Role[] }>('/iam/roles'),
    enabled: can('roles.read'),
  });

  const form = useForm<PolicyValues>({ resolver: zodResolver(policySchema) });
  useEffect(() => {
    if (policy.data) form.reset(policy.data as PolicyValues);
  }, [policy.data, form]);
  const errors = form.formState.errors;
  const mfaMode = form.watch('mfaMode');
  const expiry = form.watch('pwdExpiryDays');
  const maxSessions = form.watch('maxSessions');

  if (policy.isPending) return <Spin />;
  if (policy.isError) return <Alert type="error" showIcon message={message(policy.error)} />;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    setSaved(false);
    try {
      const body = { ...v, ...(ipRestriction ? {} : { ipAllowlist: undefined }) };
      const next = await apiClient.put<SecurityPolicy>('/iam/security-policy', body);
      qc.setQueryData(['iam-policy'], next);
      setSaved(true);
    } catch (e) {
      setError(message(e));
    }
  });

  const num = (
    name: keyof PolicyValues,
    label: string,
    opts: { min: number; max: number; suffix?: string },
  ) => (
    <Field id={`pol-${name}`} label={label} error={errors[name]?.message as string | undefined}>
      <Controller
        control={form.control}
        name={name as 'pwdMinLength'}
        render={({ field }) => (
          <InputNumber
            {...a11y(`pol-${name}`, errors[name])}
            min={opts.min}
            max={opts.max}
            disabled={!editable}
            value={field.value}
            onChange={field.onChange}
            addonAfter={opts.suffix}
            style={{ width: 200 }}
          />
        )}
      />
    </Field>
  );

  return (
    <form noValidate onSubmit={(e) => void submit(e)} style={{ maxWidth: 720 }}>
      <Form layout="vertical" component={false}>
        <Card size="small" title={t('policy.passwords')} style={{ marginBottom: 16 }}>
          {num('pwdMinLength', t('policy.pwdMinLength'), { min: 8, max: 128 })}
          {num('pwdRequireClasses', t('policy.pwdRequireClasses'), { min: 1, max: 4 })}
          {num('pwdHistory', t('policy.pwdHistory'), { min: 0, max: 24 })}
          <Field id="pol-expiry-switch" label={t('policy.pwdExpiry')}>
            <Switch
              id="pol-expiry-switch"
              disabled={!editable}
              checked={expiry !== null && expiry !== undefined}
              onChange={(on) =>
                form.setValue('pwdExpiryDays', on ? 90 : null, { shouldDirty: true })
              }
            />
          </Field>
          {expiry !== null && expiry !== undefined
            ? num('pwdExpiryDays', t('policy.pwdExpiryDays'), {
                min: 1,
                max: 3650,
                suffix: t('policy.days'),
              })
            : null}
        </Card>

        <Card size="small" title={t('policy.mfa')} style={{ marginBottom: 16 }}>
          <Field id="pol-mfaMode" label={t('policy.mfaMode')}>
            <Controller
              control={form.control}
              name="mfaMode"
              render={({ field }) => (
                <Select
                  id="pol-mfaMode"
                  disabled={!editable}
                  value={field.value}
                  onChange={field.onChange}
                  style={{ width: 320 }}
                  options={(['OFF', 'OPTIONAL', 'REQUIRED_FOR_ROLES', 'REQUIRED_ALL'] as const).map(
                    (m) => ({
                      value: m,
                      label: t(`policy.mfaModes.${m}`),
                    }),
                  )}
                />
              )}
            />
          </Field>
          {mfaMode === 'REQUIRED_FOR_ROLES' ? (
            <Field id="pol-mfaRoles" label={t('policy.mfaRoles')}>
              <Controller
                control={form.control}
                name="mfaRoles"
                render={({ field }) => (
                  <Select
                    id="pol-mfaRoles"
                    mode="multiple"
                    disabled={!editable}
                    value={field.value}
                    onChange={field.onChange}
                    optionFilterProp="label"
                    options={(roles.data?.items ?? []).map((r) => ({ value: r.id, label: r.name }))}
                  />
                )}
              />
            </Field>
          ) : null}
        </Card>

        <Card size="small" title={t('policy.sessions')} style={{ marginBottom: 16 }}>
          {num('sessionIdleMinutes', t('policy.sessionIdleMinutes'), {
            min: 5,
            max: 1440,
            suffix: 'min',
          })}
          <Field id="pol-max-switch" label={t('policy.limitSessions')}>
            <Switch
              id="pol-max-switch"
              disabled={!editable}
              checked={maxSessions !== null && maxSessions !== undefined}
              onChange={(on) => form.setValue('maxSessions', on ? 5 : null, { shouldDirty: true })}
            />
          </Field>
          {maxSessions !== null && maxSessions !== undefined
            ? num('maxSessions', t('policy.maxSessions'), { min: 1, max: 100 })
            : null}
          {num('lockoutThreshold', t('policy.lockoutThreshold'), { min: 3, max: 20 })}
          {num('lockoutMinutes', t('policy.lockoutMinutes'), { min: 1, max: 1440, suffix: 'min' })}
        </Card>

        {ipRestriction ? (
          <Card size="small" title={t('policy.network')} style={{ marginBottom: 16 }}>
            <Field
              id="pol-ip"
              label={t('policy.ipAllowlist')}
              extra={t('policy.ipHint')}
              error={
                Array.isArray(errors.ipAllowlist)
                  ? (errors.ipAllowlist.find(Boolean)?.message as string | undefined)
                  : (errors.ipAllowlist?.message as string | undefined)
              }
            >
              <Controller
                control={form.control}
                name="ipAllowlist"
                render={({ field }) => (
                  <Select
                    id="pol-ip"
                    mode="tags"
                    disabled={!editable}
                    value={field.value}
                    onChange={field.onChange}
                    tokenSeparators={[',', ' ']}
                    open={false}
                    suffixIcon={null}
                    placeholder="203.0.113.0/24"
                  />
                )}
              />
            </Field>
          </Card>
        ) : null}

        <Card size="small" title={t('policy.support')} style={{ marginBottom: 16 }}>
          <Field
            id="pol-imp"
            label={t('policy.allowImpersonation')}
            extra={t('policy.impersonationHint')}
          >
            <Controller
              control={form.control}
              name="allowImpersonation"
              render={({ field }) => (
                <Switch
                  id="pol-imp"
                  disabled={!editable}
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </Field>
        </Card>

        {error ? (
          <Alert style={{ marginBottom: 12 }} type="error" showIcon message={error} role="alert" />
        ) : null}
        {saved ? (
          <Alert
            style={{ marginBottom: 12 }}
            type="success"
            showIcon
            message={t('policy.saved')}
            role="status"
          />
        ) : null}
        {editable ? (
          <Button type="primary" htmlType="submit" loading={form.formState.isSubmitting}>
            {t('save')}
          </Button>
        ) : (
          <Alert type="info" showIcon message={t('policy.readOnly')} />
        )}
      </Form>
    </form>
  );
}
