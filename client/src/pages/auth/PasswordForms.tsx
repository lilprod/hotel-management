import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Form, Input, Result } from 'antd';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { adoptTokens, apiClient, loadMe, logout } from '../../auth/session';
import type { AuthResult } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { AuthLayout } from '../../components/AuthLayout';
import { Field, a11y } from '../../components/Field';

/** The tenant policy is enforced by the API (422 with the violated rules); 8 is its floor. */
const newPassword = z.string().min(8, 'validation.passwordMin').max(256);

const forgotSchema = z.object({ email: z.email('validation.emailInvalid') });

const resetSchema = z
  .object({ newPassword, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'validation.passwordMismatch',
  });

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, 'validation.passwordRequired'),
    newPassword,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'validation.passwordMismatch',
  });

const inviteSchema = z
  .object({
    name: z.string().trim().min(1, 'validation.required'),
    password: newPassword,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'validation.passwordMismatch',
  });

function ErrorAlert({ error }: { error: string | null }) {
  return error ? (
    <Alert style={{ marginBottom: 16 }} type="error" showIcon message={error} role="alert" />
  ) : null;
}

function useSubmit() {
  const message = useApiError();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

/** `POST /auth/password/forgot` always answers 202: the page never reveals whether the account exists. */
export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const { error, busy, run } = useSubmit();
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const errors = form.formState.errors;
  return (
    <AuthLayout title={t('forgot.title')} subtitle={t('forgot.subtitle')}>
      {sent ? (
        <Alert type="success" showIcon message={t('forgot.sent')} role="status" />
      ) : (
        <form
          noValidate
          onSubmit={form.handleSubmit((v) =>
            run(async () => {
              await apiClient.post('/auth/password/forgot', v, { skipAuth: true });
              setSent(true);
            }),
          )}
        >
          <Form layout="vertical" component={false}>
            <Field id="forgot-email" label={t('login.email')} error={errors.email?.message}>
              <Input
                {...a11y('forgot-email', errors.email)}
                type="email"
                autoComplete="username"
                {...form.register('email')}
              />
            </Field>
            <ErrorAlert error={error} />
            <Button type="primary" htmlType="submit" block loading={busy}>
              {t('forgot.submit')}
            </Button>
          </Form>
        </form>
      )}
      <p style={{ marginTop: 16, marginBottom: 0 }}>
        <Link to="/login">{t('backToLogin')}</Link>
      </p>
    </AuthLayout>
  );
}

/** Sets a new password from the single-use link (`?token=`); every session is then revoked. */
export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { error, busy, run } = useSubmit();
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirm: '' },
  });
  const errors = form.formState.errors;
  if (done)
    return (
      <AuthLayout title={t('reset.title')}>
        <Result
          status="success"
          title={t('reset.done')}
          extra={<Link to="/login">{t('backToLogin')}</Link>}
        />
      </AuthLayout>
    );
  return (
    <AuthLayout title={t('reset.title')} subtitle={t('reset.subtitle')}>
      {token.length < 20 ? (
        <Alert type="error" showIcon message={t('reset.invalidLink')} role="alert" />
      ) : (
        <form
          noValidate
          onSubmit={form.handleSubmit((v) =>
            run(async () => {
              await apiClient.post(
                '/auth/password/reset',
                { token, newPassword: v.newPassword },
                { skipAuth: true },
              );
              setDone(true);
            }),
          )}
        >
          <Form layout="vertical" component={false}>
            <Field id="new-password" label={t('newPassword')} error={errors.newPassword?.message}>
              <Input.Password
                {...a11y('new-password', errors.newPassword)}
                autoComplete="new-password"
                {...form.register('newPassword')}
              />
            </Field>
            <Field id="confirm" label={t('confirmPassword')} error={errors.confirm?.message}>
              <Input.Password
                {...a11y('confirm', errors.confirm)}
                autoComplete="new-password"
                {...form.register('confirm')}
              />
            </Field>
            <ErrorAlert error={error} />
            <Button type="primary" htmlType="submit" block loading={busy}>
              {t('reset.submit')}
            </Button>
          </Form>
        </form>
      )}
    </AuthLayout>
  );
}

/** Invitation link (`?token=`): shows who is invited, then sets the password and activates the account. */
export function AcceptInvitePage() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { error, busy, run } = useSubmit();
  const message = useApiError();
  const [info, setInfo] = useState<{
    email: string;
    name: string;
    tenant?: { name: string };
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { name: '', password: '', confirm: '' },
  });
  const errors = form.formState.errors;

  useEffect(() => {
    if (token.length < 20) {
      setLoadError(t('invite.invalidLink'));
      return;
    }
    apiClient
      .post<{ email: string; name: string; tenant?: { name: string } }>(
        '/auth/invitations/inspect',
        { token },
        { skipAuth: true },
      )
      .then((r) => {
        setInfo(r);
        form.setValue('name', r.name);
      })
      .catch((e: unknown) => setLoadError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (done)
    return (
      <AuthLayout title={t('invite.title')}>
        <Result
          status="success"
          title={t('invite.done')}
          extra={<Link to="/login">{t('login.submit')}</Link>}
        />
      </AuthLayout>
    );
  return (
    <AuthLayout
      title={t('invite.title')}
      subtitle={info ? t('invite.subtitle', { tenant: info.tenant?.name ?? '' }) : undefined}
    >
      {loadError ? (
        <Alert type="error" showIcon message={loadError} role="alert" />
      ) : info ? (
        <form
          noValidate
          onSubmit={form.handleSubmit((v) =>
            run(async () => {
              await apiClient.post(
                '/auth/invitations/accept',
                { token, password: v.password, name: v.name },
                { skipAuth: true },
              );
              setDone(true);
            }),
          )}
        >
          <Form layout="vertical" component={false}>
            <Field id="invite-email" label={t('login.email')}>
              <Input id="invite-email" value={info.email} readOnly />
            </Field>
            <Field id="invite-name" label={t('invite.name')} error={errors.name?.message}>
              <Input
                {...a11y('invite-name', errors.name)}
                autoComplete="name"
                {...form.register('name')}
              />
            </Field>
            <Field id="invite-password" label={t('newPassword')} error={errors.password?.message}>
              <Input.Password
                {...a11y('invite-password', errors.password)}
                autoComplete="new-password"
                {...form.register('password')}
              />
            </Field>
            <Field id="invite-confirm" label={t('confirmPassword')} error={errors.confirm?.message}>
              <Input.Password
                {...a11y('invite-confirm', errors.confirm)}
                autoComplete="new-password"
                {...form.register('confirm')}
              />
            </Field>
            <ErrorAlert error={error} />
            <Button type="primary" htmlType="submit" block loading={busy}>
              {t('invite.submit')}
            </Button>
          </Form>
        </form>
      ) : null}
    </AuthLayout>
  );
}

/** Mandatory change (expired / reset by an admin) or voluntary change; other sessions are revoked. */
export function ChangePasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { error, busy, run } = useSubmit();
  const form = useForm<z.infer<typeof changeSchema>>({
    resolver: zodResolver(changeSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const errors = form.formState.errors;
  return (
    <AuthLayout title={t('change.title')} subtitle={t('change.subtitle')}>
      <form
        noValidate
        onSubmit={form.handleSubmit((v) =>
          run(async () => {
            const r = await apiClient.post<AuthResult>('/auth/password', {
              currentPassword: v.currentPassword,
              newPassword: v.newPassword,
            });
            adoptTokens(r);
            await loadMe();
            navigate('/dashboard', { replace: true });
          }),
        )}
      >
        <Form layout="vertical" component={false}>
          <Field
            id="current-password"
            label={t('currentPassword')}
            error={errors.currentPassword?.message}
          >
            <Input.Password
              {...a11y('current-password', errors.currentPassword)}
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </Field>
          <Field id="new-password" label={t('newPassword')} error={errors.newPassword?.message}>
            <Input.Password
              {...a11y('new-password', errors.newPassword)}
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </Field>
          <Field id="confirm" label={t('confirmPassword')} error={errors.confirm?.message}>
            <Input.Password
              {...a11y('confirm', errors.confirm)}
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          </Field>
          <ErrorAlert error={error} />
          <Button type="primary" htmlType="submit" block loading={busy}>
            {t('change.submit')}
          </Button>
        </Form>
      </form>
      <Button type="link" style={{ padding: 0, marginTop: 16 }} onClick={() => void logout()}>
        {t('change.logout')}
      </Button>
    </AuthLayout>
  );
}
