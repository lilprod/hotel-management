import { BellOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Badge, Button, Dropdown, Grid } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { LanguageSwitch, ThemeToggle, useSessionStore } from '@hm/ui';

export function HeaderBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const user = useSessionStore((s) => s.user);

  return (
    <>
      <LanguageSwitch label={t('language')} />
      <ThemeToggle label={t('toggleTheme')} />
      <Badge dot offset={[-6, 6]}>
        <Button type="text" icon={<BellOutlined />} aria-label={t('notifications')} />
      </Badge>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'profile', label: t('profile'), icon: <UserOutlined /> },
            { type: 'divider' },
            { key: 'logout', label: t('logout'), icon: <LogoutOutlined /> },
          ],
          onClick: ({ key }) => {
            if (key === 'logout') navigate('/login');
          },
        }}
      >
        <Button type="text" icon={<UserOutlined />} aria-label={t('userMenu')}>
          {screens.md ? user?.name : null}
        </Button>
      </Dropdown>
    </>
  );
}
