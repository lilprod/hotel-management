import {
  BankOutlined,
  BarChartOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  NotificationOutlined,
  ProfileOutlined,
  SettingOutlined,
  SolutionOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { NavModule } from '@hm/ui';
import type { ReactElement } from 'react';

export interface ModuleDef extends NavModule {
  icon: ReactElement;
}

/** Registry of Super Admin (platform) modules; the sidebar and routes are derived from it. */
export const modules: readonly ModuleDef[] = [
  { key: 'dashboard', labelKey: 'nav:dashboard', icon: <DashboardOutlined />, path: '/dashboard' },
  {
    key: 'tenants',
    labelKey: 'nav:tenants',
    icon: <BankOutlined />,
    path: '/tenants',
    requiredPermission: 'platform.tenants.read',
  },
  {
    key: 'plans',
    labelKey: 'nav:plans',
    icon: <ProfileOutlined />,
    path: '/plans',
    requiredPermission: 'platform.plans.read',
  },
  {
    key: 'invoices',
    labelKey: 'nav:invoices',
    icon: <FileTextOutlined />,
    path: '/invoices',
    requiredPermission: 'platform.invoices.read',
  },
  {
    key: 'payments',
    labelKey: 'nav:payments',
    icon: <CreditCardOutlined />,
    path: '/payments',
    requiredPermission: 'platform.payments.read',
  },
  {
    key: 'payment-declarations',
    labelKey: 'nav:paymentDeclarations',
    icon: <FileDoneOutlined />,
    path: '/payment-declarations',
    requiredPermission: 'platform.payments.review',
  },
  {
    key: 'reports',
    labelKey: 'nav:reports',
    icon: <BarChartOutlined />,
    path: '/reports',
    requiredPermission: 'platform.reports.read',
  },
  {
    key: 'announcements',
    labelKey: 'nav:announcements',
    icon: <NotificationOutlined />,
    path: '/announcements',
    requiredPermission: 'platform.announcements.read',
  },
  {
    key: 'support',
    labelKey: 'nav:support',
    icon: <SolutionOutlined />,
    path: '/support',
    requiredPermission: 'platform.support.read',
  },
  {
    key: 'platform-users',
    labelKey: 'nav:platformUsers',
    icon: <TeamOutlined />,
    path: '/platform-users',
    requiredPermission: 'platform.users.read',
  },
  {
    key: 'settings',
    labelKey: 'nav:settings',
    icon: <SettingOutlined />,
    path: '/settings',
    requiredPermission: 'platform.settings.read',
  },
];
