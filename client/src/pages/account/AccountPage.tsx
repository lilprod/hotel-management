import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Descriptions, Flex, Form, Input, Modal, Tabs, Tag } from 'antd';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { BackupCodes, PageHeader, TotpSetup } from '@hm/ui';

import { adoptTokens, apiClient, loadMe, useMeStore } from '../../auth/session';
import type { AuthResult } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { Field, a11y } from '../../components/Field';
import { fmtDate, SessionsPanel } from '../security/SessionsPanel';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'validation.passwordRequired'),
    newPassword: z.string().min(8, 'validation.passwordMin').max(256),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'validation.passwordMismatch',
  });

function PasswordPanel() {
  const { t } = useTranslation(['security', 'auth']);
  const message = useApiError();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const errors = form.formState.errors;
  return (
    <form
      noValidate
      style={{ maxWidth: 420 }}
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        setDone(false);
        try {
          const r = await apiClient.post<AuthResult>('/auth/password', {
            currentPassword: v.currentPassword,
            newPassword: v.newPassword,
          });
          adoptTokens(r);
          form.reset();
          setDone(true);
        } catch (e) {
          setError(message(e));
        }
      })}
    >
      <Form layout="vertical" component={false}>
        <Field
          id="acc-current"
          label={t('auth:currentPassword')}
          error={errors.currentPassword?.message}
        >
          <Input.Password
            {...a11y('acc-current', errors.currentPassword)}
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
        </Field>
        <Field id="acc-new" label={t('auth:newPassword')} error={errors.newPassword?.message}>
          <Input.Password
            {...a11y('acc-new', errors.newPassword)}
            autoComplete="new-password"
            {...form.register('newPassword')}
          />
        </Field>
        <Field id="acc-confirm" label={t('auth:confirmPassword')} error={errors.confirm?.message}>
          <Input.Password
            {...a11y('acc-confirm', errors.confirm)}
            autoComplete="new-password"
            {...form.register('confirm')}
          />
        </Field>
        {error ? (
          <Alert type="error" showIcon message={error} role="alert" style={{ marginBottom: 16 }} />
        ) : null}
        {done ? (
          <Alert
            type="success"
            showIcon
            message={t('account.passwordChanged')}
            role="status"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Button type="primary" htmlType="submit" loading={form.formState.isSubmitting}>
          {t('auth:change.submit')}
        </Button>
      </Form>
    </form>
  );
}

type PasswordAction = 'disable' | 'regenerate';

function TwoFactorPanel() {
  const { t } = useTranslation(['security', 'auth']);
  const message = useApiError();
  const me = useMeStore((s) => s.me);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PasswordAction | null>(null);
  const [password, setPassword] = useState('');
  const enabled = me?.user.mfaEnabled ?? false;

  const guard = async (fn: () => Promise<void>) => {
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

  const start = () =>
    guard(async () => {
      setSetup(await apiClient.post<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', {}));
    });
  const activate = (code: string) =>
    guard(async () => {
      const r = await apiClient.post<AuthResult>('/auth/mfa/activate', { code });
      adoptTokens(r);
      setSetup(null);
      setCodes(r.backupCodes ?? []);
      await loadMe();
    });
  const confirmPassword = () =>
    guard(async () => {
      if (confirm === 'disable') {
        await apiClient.post('/auth/mfa/disable', { password });
        await loadMe();
      } else {
        const r = await apiClient.post<{ backupCodes: string[] }>('/auth/mfa/backup-codes', {
          password,
        });
        setCodes(r.backupCodes);
      }
      setConfirm(null);
      setPassword('');
    });

  const labels = {
    scan: t('auth:totp.scan'),
    manual: t('auth:totp.manual'),
    qrAlt: t('auth:totp.qrAlt'),
    code: t('auth:totp.code'),
    codeHint: t('auth:totp.codeHint'),
    activate: t('auth:totp.activate'),
    copy: t('auth:totp.copy'),
    copied: t('auth:totp.copied'),
  };

  return (
    <Flex vertical gap={16} style={{ maxWidth: 640 }}>
      <Flex align="center" gap={8}>
        <strong>{t('account.twoFactor')}</strong>
        <Tag color={enabled ? 'green' : 'default'}>
          {enabled ? t('account.enabled') : t('account.disabled')}
        </Tag>
      </Flex>
      {error && !confirm ? <Alert type="error" showIcon message={error} role="alert" /> : null}
      {codes ? (
        <BackupCodes
          codes={codes}
          labels={{
            title: t('auth:backup.codesTitle'),
            warning: t('auth:backup.warning'),
            download: t('auth:backup.download'),
            fileName: 'hm-backup-codes.txt',
          }}
        />
      ) : null}
      {setup ? (
        <TotpSetup
          otpauthUri={setup.otpauthUri}
          secret={setup.secret}
          labels={labels}
          busy={busy}
          error={error}
          onActivate={(c) => void activate(c)}
        />
      ) : enabled ? (
        <Flex gap={8} wrap>
          <Button onClick={() => setConfirm('regenerate')}>{t('account.regenerate')}</Button>
          <Button danger onClick={() => setConfirm('disable')}>
            {t('account.disable')}
          </Button>
        </Flex>
      ) : (
        <div>
          <Button type="primary" loading={busy} onClick={() => void start()}>
            {t('account.enable')}
          </Button>
        </div>
      )}
      <Modal
        open={confirm !== null}
        title={confirm === 'disable' ? t('account.disable') : t('account.regenerate')}
        okText={t('confirm')}
        cancelText={t('cancel')}
        confirmLoading={busy}
        okButtonProps={{ disabled: password.length === 0 }}
        onOk={() => void confirmPassword()}
        onCancel={() => {
          setConfirm(null);
          setPassword('');
          setError(null);
        }}
      >
        <label htmlFor="mfa-confirm-password">{t('account.confirmPassword')}</label>
        <Input.Password
          id="mfa-confirm-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} role="alert" />
        ) : null}
      </Modal>
    </Flex>
  );
}

/** My account: profile, password, 2FA (QR code + backup codes) and active sessions. */
export function AccountPage() {
  const { t, i18n } = useTranslation('security');
  const me = useMeStore((s) => s.me);
  return (
    <>
      <PageHeader title={t('account.title')} subtitle={me?.user.email} />
      <Tabs
        items={[
          {
            key: 'profile',
            label: t('account.profile'),
            children: me ? (
              <Descriptions column={1} bordered size="small" style={{ maxWidth: 560 }}>
                <Descriptions.Item label={t('users.name')}>{me.user.name}</Descriptions.Item>
                <Descriptions.Item label={t('users.email')}>{me.user.email}</Descriptions.Item>
                <Descriptions.Item label={t('account.hotel')}>{me.tenant.name}</Descriptions.Item>
                <Descriptions.Item label={t('users.properties')}>
                  {me.properties.map((p) => p.name).join(', ') || '—'}
                </Descriptions.Item>
                <Descriptions.Item label={t('users.lastLogin')}>
                  {fmtDate(me.user.lastLoginAt, i18n.language)}
                </Descriptions.Item>
              </Descriptions>
            ) : null,
          },
          { key: 'password', label: t('account.password'), children: <PasswordPanel /> },
          { key: '2fa', label: t('account.twoFactor'), children: <TwoFactorPanel /> },
          { key: 'sessions', label: t('tabs.sessions'), children: <SessionsPanel /> },
        ]}
      />
    </>
  );
}
