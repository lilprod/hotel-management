import { MailOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Flex, Result, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import { resendVerification } from './api';
import { SignupLayout } from './SignupLayout';

export interface CheckEmailState {
  email: string;
  host: string;
  slug: string;
}

const COOLDOWN_S = 60;

/** "Check your inbox" screen shown after a successful signup. */
export function CheckEmailPage() {
  const { t } = useTranslation('signup');
  const state = useLocation().state as CheckEmailState | null;
  const [cooldown, setCooldown] = useState(COOLDOWN_S);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (!state)
    return (
      <SignupLayout>
        <Result
          status="info"
          title={t('check.none')}
          extra={
            <Link to="/signup/new">
              <Button type="primary">{t('check.restart')}</Button>
            </Link>
          }
        />
      </SignupLayout>
    );

  async function resend() {
    if (!state) return;
    setBusy(true);
    try {
      await resendVerification(state.slug, state.email);
      setResent(true);
      setCooldown(COOLDOWN_S);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignupLayout>
      <div style={{ maxWidth: 560, margin: '48px auto 0' }}>
        <Card>
          <Flex vertical align="center" gap={8} style={{ textAlign: 'center' }}>
            <MailOutlined
              style={{ fontSize: 48, color: 'var(--ant-color-primary, #1677ff)' }}
              aria-hidden
            />
            <Typography.Title level={1} style={{ fontSize: 26, margin: 0 }}>
              {t('check.title')}
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 4 }}>
              {t('check.text', { email: state.email, host: state.host })}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary">{t('check.hint')}</Typography.Paragraph>
            {resent ? <Alert type="success" showIcon message={t('check.resent')} /> : null}
            <Button onClick={() => void resend()} disabled={cooldown > 0} loading={busy}>
              {cooldown > 0 ? t('check.wait', { seconds: cooldown }) : t('check.resend')}
            </Button>
          </Flex>
        </Card>
      </div>
    </SignupLayout>
  );
}
