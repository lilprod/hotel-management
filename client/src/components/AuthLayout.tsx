import { Card, Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LanguageSwitch, ThemeToggle } from '@hm/ui';

/** Centered card shared by the pre-login screens (login, reset, invitation, legal…). */
export function AuthLayout({
  title,
  subtitle,
  children,
  width = 420,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const { t } = useTranslation();
  return (
    <Flex justify="center" align="center" style={{ minHeight: '100vh', padding: 16 }}>
      <main style={{ width: '100%', maxWidth: width }}>
        <Card>
          <Flex justify="flex-end" gap={4}>
            <LanguageSwitch label={t('language')} />
            <ThemeToggle label={t('toggleTheme')} />
          </Flex>
          <Typography.Title level={1} style={{ fontSize: 24, marginBottom: 0 }}>
            {title}
          </Typography.Title>
          {subtitle ? (
            <Typography.Paragraph type="secondary">{subtitle}</Typography.Paragraph>
          ) : null}
          {children}
        </Card>
      </main>
    </Flex>
  );
}
