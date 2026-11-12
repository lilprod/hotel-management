import {
  BellOutlined,
  LoginOutlined,
  LogoutOutlined,
  PlusOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Badge, Button, Dropdown, Grid, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { LanguageSwitch, ThemeToggle, useSessionStore } from '@hm/ui';

export function HeaderBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const user = useSessionStore((s) => s.user);

  const actions = [
    { key: 'booking', label: t('newBooking'), path: '/reservations', icon: <PlusOutlined /> },
    { key: 'check-in', label: t('checkIn'), path: '/front-desk', icon: <LoginOutlined /> },
    { key: 'check-out', label: t('checkOut'), path: '/front-desk', icon: <LogoutOutlined /> },
  ];

  return (
    <>
      {screens.md ? (
        <Space role="group" aria-label={t('quickActions')} size={8}>
          {actions.map((a, i) => (
            <Button
              key={a.key}
              size="small"
              type={i === 0 ? 'primary' : 'default'}
              icon={a.icon}
              onClick={() => navigate(a.path)}
            >
              {a.label}
            </Button>
          ))}
        </Space>
      ) : (
        <Dropdown
          trigger={['click']}
          menu={{
            items: actions.map((a) => ({ key: a.key, label: a.label, icon: a.icon })),
            onClick: ({ key }) => {
              const action = actions.find((a) => a.key === key);
              if (action) navigate(action.path);
            },
          }}
        >
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            aria-label={t('quickActions')}
          />
        </Dropdown>
      )}
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
