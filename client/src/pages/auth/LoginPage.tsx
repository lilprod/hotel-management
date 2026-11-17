import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Flex, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { BackupCodes, TotpSetup } from '@hm/ui';

import { adoptTokens, apiClient, loadMe, type AuthResult } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { AuthLayout } from '../../components/AuthLayout';
import { Field, a11y, bind } from '../../components/Field';

// Messages are i18n keys, translated at render time.
export const loginSchema = z.object({
  email: z.email('validation.emailInvalid'),
  password: z.string().min(1, 'validation.passwordRequired'),
});
export type LoginValues = z.infer<typeof loginSchema>;

const mfaSchema = z.object({ code: z.string().trim().min(6, 'validation.codeInvalid') });
type MfaValues = z.infer<typeof mfaSchema>;

type Step =
  | { kind: 'credentials' }
  | { kind: 'mfa'; challengeToken: string; backup: boolean }
  | { kind: 'setup'; challengeToken: string; secret: string; otpauthUri: string }
  | { kind: 'backup'; codes: string[] };

/** Staff login: password → (TOTP | forced TOTP enrolment + backup codes) → session. */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const message = useApiError();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const credentials = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const mfa = useForm<MfaValues>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: '' },
  });

  async function finish(result: AuthResult) {
    if (!adoptTokens(result)) throw new Error('no token');
    await loadMe();
    navigate(from, { replace: true });
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const submitCredentials = credentials.handleSubmit((v) =>
    run(async () => {
      const r = await apiClient.post<AuthResult>('/auth/login', v, { skipAuth: true });
      if (r.mfaRequired && r.challengeToken) {
        mfa.reset({ code: '' });
        setStep({ kind: 'mfa', challengeToken: r.challengeToken, backup: false });
      } else if (r.mfaSetupRequired && r.challengeToken) {
        const s = await apiClient.post<{ secret: string; otpauthUri: string }>(
          '/auth/mfa/setup',
          { challengeToken: r.challengeToken },
          { skipAuth: true },
        );
        setStep({ kind: 'setup', challengeToken: r.challengeToken, ...s });
      } else {
        await finish(r);
      }
    }),
  );

  const submitMfa = mfa.handleSubmit((v) =>
    run(async () => {
      if (step.kind !== 'mfa') return;
      const r = await apiClient.post<AuthResult>(
        '/auth/mfa/verify',
        { challengeToken: step.challengeToken, code: v.code },
        { skipAuth: true },
      );
      await finish(r);
    }),
  );

  const activate = (code: string) =>
    run(async () => {
      if (step.kind !== 'setup') return;
      const r = await apiClient.post<AuthResult>(
        '/auth/mfa/activate',
        { code, challengeToken: step.challengeToken },
        { skipAuth: true },
      );
      adoptTokens(r);
      setStep({ kind: 'backup', codes: r.backupCodes ?? [] });
    });

  if (step.kind === 'setup') {
    return (
      <AuthLayout title={t('auth:setup.title')} subtitle={t('auth:setup.subtitle')} width={560}>
        <TotpSetup
          otpauthUri={step.otpauthUri}
          secret={step.secret}
          busy={busy}
          error={error}
          onActivate={(code) => void activate(code)}
          labels={{
            scan: t('auth:totp.scan'),
            manual: t('auth:totp.manual'),
            qrAlt: t('auth:totp.qrAlt'),
            code: t('auth:totp.code'),
            codeHint: t('auth:totp.codeHint'),
            activate: t('auth:totp.activate'),
            copy: t('auth:totp.copy'),
            copied: t('auth:totp.copied'),
          }}
        />
      </AuthLayout>
    );
  }

  if (step.kind === 'backup') {
    return (
      <AuthLayout title={t('auth:backup.title')} subtitle={t('auth:backup.subtitle')} width={480}>
        <Flex vertical gap={16}>
          <BackupCodes
            codes={step.codes}
            labels={{
              title: t('auth:backup.codesTitle'),
              warning: t('auth:backup.warning'),
              download: t('auth:backup.download'),
              fileName: 'hm-backup-codes.txt',
            }}
          />
          {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
          <Button
            type="primary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await loadMe();
                navigate(from, { replace: true });
              })
            }
          >
            {t('auth:backup.continue')}
          </Button>
        </Flex>
      </AuthLayout>
    );
  }

  if (step.kind === 'mfa') {
    const errors = mfa.formState.errors;
    return (
      <AuthLayout key="mfa" title={t('auth:mfa.title')} subtitle={t('auth:mfa.subtitle')}>
        <form noValidate onSubmit={submitMfa}>
          <Form layout="vertical" component={false}>
            <Field
              id="mfa-code"
              label={step.backup ? t('auth:mfa.backupCode') : t('auth:mfa.code')}
              error={errors.code?.message}
            >
              <Input
                {...a11y('mfa-code', errors.code)}
                inputMode={step.backup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                {...bind(mfa.register('code'))}
              />
            </Field>
            {error ? (
              <Alert
                style={{ marginBottom: 16 }}
                type="error"
                showIcon
                message={error}
                role="alert"
              />
            ) : null}
            <Button type="primary" htmlType="submit" block loading={busy}>
              {t('auth:mfa.submit')}
            </Button>
          </Form>
        </form>
        <Flex justify="space-between" style={{ marginTop: 16 }}>
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => {
              mfa.reset({ code: '' });
              setStep({ ...step, backup: !step.backup });
            }}
          >
            {step.backup ? t('auth:mfa.useApp') : t('auth:mfa.useBackup')}
          </Button>
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => {
              setError(null);
              setStep({ kind: 'credentials' });
            }}
          >
            {t('auth:mfa.back')}
          </Button>
        </Flex>
      </AuthLayout>
    );
  }

  const errors = credentials.formState.errors;
  return (
    <AuthLayout key="login" title={t('auth:login.title')} subtitle={t('auth:login.subtitle')}>
      <form noValidate onSubmit={submitCredentials}>
        <Form layout="vertical" component={false}>
          <Field id="email" label={t('auth:login.email')} error={errors.email?.message}>
            <Input
              {...a11y('email', errors.email)}
              type="email"
              autoComplete="username"
              {...bind(credentials.register('email'))}
            />
          </Field>
          <Field id="password" label={t('auth:login.password')} error={errors.password?.message}>
            <Input.Password
              {...a11y('password', errors.password)}
              autoComplete="current-password"
              {...bind(credentials.register('password'))}
            />
          </Field>
          {error ? (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              message={error}
              role="alert"
            />
          ) : null}
          <Button type="primary" htmlType="submit" block loading={busy}>
            {t('auth:login.submit')}
          </Button>
        </Form>
      </form>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
        <Link to="/forgot-password">{t('auth:login.forgot')}</Link>
      </Typography.Paragraph>
    </AuthLayout>
  );
}
