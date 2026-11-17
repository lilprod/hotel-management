import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { z } from 'zod';

import { apiClient, logout, useMeStore } from '../auth/session';
import { AuthField } from '../components/AuthField';
import { PageHero } from '../components/PageHero';
import { changePasswordSchema, useSubmit } from './auth/AuthPages';
import './auth.css';
import './sections.css';

function ChangePassword() {
  const { t } = useTranslation('auth');
  const { busy, error, run } = useSubmit();
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit((v) =>
    run(async () => {
      await apiClient.post('/auth/password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      setDone(true);
      form.reset();
    }),
  );
  return (
    <form
      noValidate
      onSubmit={submit}
      className="auth-form"
      aria-label={t('profile.passwordTitle')}
    >
      <AuthField
        id="currentPassword"
        label={t('fields.currentPassword')}
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        register={form.register('currentPassword')}
      />
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
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="notice notice-ok" role="status">
          {t('profile.passwordChanged')}
        </p>
      ) : null}
      <button type="submit" className="button" disabled={busy}>
        {t('profile.passwordSubmit')}
      </button>
    </form>
  );
}

/** Guest account: profile (read-only: the API only exposes `/me`), password change, logout. */
export default function AccountPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeStore((s) => s.me);

  const rows: [string, string][] = me
    ? [
        [t('auth:fields.firstName'), me.guest.firstName],
        [t('auth:fields.lastName'), me.guest.lastName],
        [t('auth:fields.email'), me.account.email],
        [t('auth:fields.phone'), me.guest.phone ?? '—'],
        [
          t('auth:profile.lastLogin'),
          me.account.lastLoginAt
            ? new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'long',
                timeStyle: 'short',
              }).format(new Date(me.account.lastLoginAt))
            : '—',
        ],
      ]
    : [];

  return (
    <>
      <PageHero
        titleId="account-title"
        title={t('pages:account.title')}
        lead={me ? t('auth:profile.hello', { name: me.guest.firstName }) : undefined}
        photo="garden"
      />
      <section className="section" aria-labelledby="profile-title">
        <div className="container profile-grid">
          <div>
            <h2 id="profile-title" className="section-title">
              {t('auth:profile.title')}
            </h2>
            <dl className="profile-list">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              {me ? (
                <div>
                  <dt>{t('auth:profile.emailStatus')}</dt>
                  <dd>
                    <span className={`badge ${me.account.emailVerified ? 'badge-ok' : ''}`}>
                      {me.account.emailVerified
                        ? t('auth:profile.verified')
                        : t('auth:profile.notVerified')}
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="auth-actions">
              <Link className="button" to="/booking">
                {t('pages:account.cta')}
              </Link>
              <button
                type="button"
                className="button button-ghost"
                onClick={() =>
                  void logout().then(() => navigate('/account/login', { replace: true }))
                }
              >
                {t('auth:profile.logout')}
              </button>
            </p>
          </div>
          <div className="auth-card auth-card-inline">
            <h2 className="section-title">{t('auth:profile.passwordTitle')}</h2>
            <ChangePassword />
          </div>
        </div>
      </section>
    </>
  );
}
