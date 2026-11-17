import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError, useSessionStore } from '@hm/ui/core';

import { adoptTokens, apiClient, loadMe } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { AuthField } from '../../components/AuthField';
import { AuthShell } from '../../components/AuthShell';

// Messages are i18n keys, translated at render time.
const email = z.string().trim().email('auth:validation.emailInvalid');
const password = z
  .string()
  .min(8, 'auth:validation.passwordMin')
  .max(256, 'auth:validation.passwordMax');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'auth:validation.passwordRequired'),
});
export const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'auth:validation.required').max(80),
  lastName: z.string().trim().min(1, 'auth:validation.required').max(80),
  email,
  phone: z.string().trim().max(30, 'auth:validation.phoneMax').optional(),
  password,
});
export const forgotSchema = z.object({ email });
export const resetSchema = z
  .object({ newPassword: password, confirm: z.string() })
  .refine((v) => v.confirm === v.newPassword, {
    path: ['confirm'],
    message: 'auth:validation.passwordMismatch',
  });
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'auth:validation.passwordRequired'),
    newPassword: password,
    confirm: z.string(),
  })
  .refine((v) => v.confirm === v.newPassword, {
    path: ['confirm'],
    message: 'auth:validation.passwordMismatch',
  });

/** Busy / error handling shared by the forms. */
export function useSubmit() {
  const message = useApiError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return { busy, error, run, setError };
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}

function Notice({ children, tone = 'ok' }: { children: ReactNode; tone?: 'ok' | 'error' }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/** "Send the verification link again" mini-form (always answers 202, no account enumeration). */
function ResendVerification({ initialEmail = '' }: { initialEmail?: string }) {
  const { t } = useTranslation('auth');
  const { busy, error, run } = useSubmit();
  const [sent, setSent] = useState(false);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: initialEmail },
  });
  const submit = form.handleSubmit((v) =>
    run(async () => {
      await apiClient.post('/auth/verify-email/resend', v, { skipAuth: true });
      setSent(true);
    }),
  );
  if (sent) return <Notice>{t('verify.resent')}</Notice>;
  return (
    <form noValidate onSubmit={submit} className="auth-form" aria-label={t('verify.resendTitle')}>
      <AuthField
        id="resend-email"
        label={t('fields.email')}
        type="email"
        autoComplete="email"
        error={form.formState.errors.email?.message}
        register={form.register('email')}
      />
      <FormError message={error} />
      <button type="submit" className="button" disabled={busy}>
        {t('verify.resend')}
      </button>
    </form>
  );
}

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { error, setError } = useSubmit();
  const [unverified, setUnverified] = useState<string | null>(null);
  const message = useApiError();
  const from = (location.state as { from?: string } | null)?.from ?? '/account';
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    setUnverified(null);
    setError(null);
    try {
      await (async () => {
        const r = await apiClient.post<{ accessToken?: string; csrfToken?: string }>(
          '/auth/login',
          v,
          { skipAuth: true },
        );
        if (!adoptTokens(r)) throw new Error('no token');
        await loadMe();
        navigate(from, { replace: true });
      })();
    } catch (e) {
      if (e instanceof ApiError && e.reason === 'EMAIL_NOT_VERIFIED') setUnverified(v.email);
      else setError(message(e));
    }
  });

  return (
    <AuthShell
      titleId="login-title"
      title={t('login.title')}
      lead={t('login.lead')}
      footer={
        <p>
          {t('login.noAccount')}{' '}
          <Link className="text-link" to="/account/register" state={location.state}>
            {t('login.register')}
          </Link>
        </p>
      }
    >
      <form noValidate onSubmit={submit} className="auth-form">
        <AuthField
          id="email"
          label={t('fields.email')}
          type="email"
          autoComplete="username"
          error={errors.email?.message}
          register={form.register('email')}
        />
        <AuthField
          id="password"
          label={t('fields.password')}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          register={form.register('password')}
        />
        <FormError message={error} />
        <button type="submit" className="button" disabled={form.formState.isSubmitting}>
          {t('login.submit')}
        </button>
        <Link className="text-link auth-secondary" to="/account/forgot-password">
          {t('login.forgot')}
        </Link>
      </form>
      {unverified ? (
        <div className="stack">
          <Notice tone="error">{t('login.unverified')}</Notice>
          <ResendVerification initialEmail={unverified} />
        </div>
      ) : null}
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation('auth');
  const { busy, error, run } = useSubmit();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '', password: '' },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit((v) =>
    run(async () => {
      await apiClient.post(
        '/auth/register',
        {
          ...v,
          phone: v.phone?.trim() ? v.phone.trim() : undefined,
          locale: i18n.language === 'en' ? 'en' : 'fr',
        },
        { skipAuth: true },
      );
      setSentTo(v.email);
    }),
  );

  if (sentTo) {
    return (
      <AuthShell titleId="register-title" title={t('register.sentTitle')}>
        <Notice>{t('register.sent', { email: sentTo })}</Notice>
        <p className="auth-lead">{t('register.sentHelp')}</p>
        <ResendVerification initialEmail={sentTo} />
        <div className="auth-footer">
          <Link className="text-link" to="/account/login">
            {t('backToLogin')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      titleId="register-title"
      title={t('register.title')}
      lead={t('register.lead')}
      footer={
        <p>
          {t('register.haveAccount')}{' '}
          <Link className="text-link" to="/account/login">
            {t('register.login')}
          </Link>
        </p>
      }
    >
      <form noValidate onSubmit={submit} className="auth-form">
        <div className="field-row">
          <AuthField
            id="firstName"
            label={t('fields.firstName')}
            autoComplete="given-name"
            error={errors.firstName?.message}
            register={form.register('firstName')}
          />
          <AuthField
            id="lastName"
            label={t('fields.lastName')}
            autoComplete="family-name"
            error={errors.lastName?.message}
            register={form.register('lastName')}
          />
        </div>
        <AuthField
          id="email"
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          register={form.register('email')}
        />
        <AuthField
          id="phone"
          label={t('fields.phone')}
          type="tel"
          autoComplete="tel"
          hint={t('fields.phoneHint')}
          error={errors.phone?.message}
          register={form.register('phone')}
        />
        <AuthField
          id="password"
          label={t('fields.password')}
          type="password"
          autoComplete="new-password"
          hint={t('fields.passwordHint')}
          error={errors.password?.message}
          register={form.register('password')}
        />
        <FormError message={error} />
        <button type="submit" className="button" disabled={busy}>
          {t('register.submit')}
        </button>
      </form>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const token = params.get('token');
  const message = useApiError();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const [detail, setDetail] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    apiClient
      .post('/auth/verify-email', { token }, { skipAuth: true })
      .then(() => setState('ok'))
      .catch((e: unknown) => {
        setDetail(message(e));
        setState('error');
      });
  }, [token, message]);

  return (
    <AuthShell
      titleId="verify-title"
      title={state === 'ok' ? t('verify.okTitle') : t('verify.title')}
    >
      {state === 'pending' ? <Notice>{t('verify.pending')}</Notice> : null}
      {state === 'ok' ? (
        <>
          <Notice>{t('verify.ok')}</Notice>
          <p className="auth-actions">
            <Link className="button" to="/account/login">
              {t('verify.login')}
            </Link>
          </p>
        </>
      ) : null}
      {state === 'error' ? (
        <>
          <Notice tone="error">{detail ?? t('verify.invalid')}</Notice>
          <p className="auth-lead">{t('verify.resendHelp')}</p>
          <ResendVerification />
        </>
      ) : null}
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const { busy, error, run } = useSubmit();
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const submit = form.handleSubmit((v) =>
    run(async () => {
      await apiClient.post('/auth/password/forgot', v, { skipAuth: true });
      setSent(true);
    }),
  );
  return (
    <AuthShell
      titleId="forgot-title"
      title={t('forgot.title')}
      lead={t('forgot.lead')}
      footer={
        <Link className="text-link" to="/account/login">
          {t('backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <Notice>{t('forgot.sent')}</Notice>
      ) : (
        <form noValidate onSubmit={submit} className="auth-form">
          <AuthField
            id="email"
            label={t('fields.email')}
            type="email"
            autoComplete="email"
            error={form.formState.errors.email?.message}
            register={form.register('email')}
          />
          <FormError message={error} />
          <button type="submit" className="button" disabled={busy}>
            {t('forgot.submit')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const token = params.get('token');
  const { busy, error, run } = useSubmit();
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirm: '' },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit((v) =>
    run(async () => {
      await apiClient.post(
        '/auth/password/reset',
        { token, newPassword: v.newPassword },
        { skipAuth: true },
      );
      setDone(true);
    }),
  );
  return (
    <AuthShell titleId="reset-title" title={t('reset.title')} lead={t('reset.lead')}>
      {!token ? (
        <>
          <Notice tone="error">{t('reset.invalidLink')}</Notice>
          <p className="auth-actions">
            <Link className="button" to="/account/forgot-password">
              {t('reset.newLink')}
            </Link>
          </p>
        </>
      ) : done ? (
        <>
          <Notice>{t('reset.done')}</Notice>
          <p className="auth-actions">
            <Link className="button" to="/account/login">
              {t('login.submit')}
            </Link>
          </p>
        </>
      ) : (
        <form noValidate onSubmit={submit} className="auth-form">
          <AuthField
            id="newPassword"
            label={t('fields.newPassword')}
            type="password"
            autoComplete="new-password"
            hint={t('fields.passwordHint')}
            error={errors.newPassword?.message}
            register={form.register('newPassword')}
          />
          <AuthField
            id="confirm"
            label={t('fields.confirmPassword')}
            type="password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            register={form.register('confirm')}
          />
          <FormError message={error} />
          <button type="submit" className="button" disabled={busy}>
            {t('reset.submit')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

/** Redirects to the login page (remembering the target) when there is no guest session. */
export function RequireAccount({ children }: { children: ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const location = useLocation();
  const { t } = useTranslation();
  if (status === 'unknown')
    return (
      <p role="status" className="route-loading">
        {t('loading')}
      </p>
    );
  if (status !== 'authenticated')
    return <Navigate to="/account/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
