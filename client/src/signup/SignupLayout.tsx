import { Button, Flex, Layout, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { LanguageSwitch, ThemeToggle } from '@hm/ui';

/** Page frame of the public pages served on the platform host (landing, signup, verification). */
export function SignupLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['signup', 'common']);
  const { token } = theme.useToken();
  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Layout.Header
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          paddingInline: 16,
          height: 56,
          lineHeight: '56px',
        }}
      >
        <Flex align="center" justify="space-between" style={{ maxWidth: 1120, margin: '0 auto' }}>
          <Link to="/signup" style={{ color: token.colorText, fontWeight: 700, fontSize: 17 }}>
            {t('signup:brand')}
          </Link>
          <Flex align="center" gap={8}>
            <LanguageSwitch label={t('common:language')} />
            <ThemeToggle label={t('common:toggleTheme')} />
            <Button href="/login" type="link" size="small">
              {t('signup:nav.login')}
            </Button>
          </Flex>
        </Flex>
      </Layout.Header>
      <Layout.Content id="main" style={{ padding: '0 16px 48px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>{children}</div>
      </Layout.Content>
      <Layout.Footer style={{ textAlign: 'center', background: 'transparent' }}>
        <Typography.Text type="secondary">{t('signup:brand')} · Lomé, Togo</Typography.Text>
      </Layout.Footer>
    </Layout>
  );
}
