import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { useCan } from '../../auth/useCan';
import { AuditTab } from './AuditTab';
import { PolicyTab } from './PolicyTab';
import { RolesTab } from './RolesTab';
import { SessionsPanel } from './SessionsPanel';
import { SupportTab } from './SupportTab';
import { UsersTab } from './UsersTab';

/** Settings → Security: users, roles, policy, sessions, audit log, support access. */
export function SecurityPage() {
  const { t } = useTranslation('security');
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { can } = useCan();

  const tabs = [
    { key: 'users', show: can('users.read'), label: t('tabs.users'), children: <UsersTab /> },
    { key: 'roles', show: can('roles.read'), label: t('tabs.roles'), children: <RolesTab /> },
    { key: 'policy', show: can('security.read'), label: t('tabs.policy'), children: <PolicyTab /> },
    { key: 'sessions', show: true, label: t('tabs.sessions'), children: <SessionsPanel /> },
    { key: 'audit', show: can('audit.read'), label: t('tabs.audit'), children: <AuditTab /> },
    {
      key: 'support',
      show: can('security.read'),
      label: t('tabs.support'),
      children: <SupportTab />,
    },
  ].filter((x) => x.show);

  const active = tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs
        activeKey={active}
        onChange={(k) => navigate(`/settings/security/${k}`)}
        items={tabs.map(({ key, label, children }) => ({ key, label, children }))}
        destroyInactiveTabPane
      />
    </>
  );
}
