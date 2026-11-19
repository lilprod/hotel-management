import type { ReactElement } from 'react';

import { DashboardPage } from './pages/dashboard/DashboardPage';
import { PlatformAuditPage } from './pages/audit/PlatformAuditPage';
import { ImpersonationsPage } from './pages/impersonations/ImpersonationsPage';
import { PaymentDetailPage } from './pages/payments/PaymentDetailPage';
import { PaymentFormPage } from './pages/payments/PaymentFormPage';
import { PaymentsPage } from './pages/payments/PaymentsPage';
import { PlatformUsersPage } from './pages/platform-users/PlatformUsersPage';

/** Page of each module key (the sidebar entry and its main route come from `modules.tsx`). */
export const pages: Record<string, ReactElement> = {
  dashboard: <DashboardPage />,
  payments: <PaymentsPage />,
  'platform-users': <PlatformUsersPage />,
  impersonations: <ImpersonationsPage />,
  audit: <PlatformAuditPage />,
};

/** Detail / creation routes that are not sidebar entries; they inherit the module's permission. */
export const subRoutes: { path: string; module: string; element: ReactElement }[] = [
  { path: '/payments/new', module: 'payments', element: <PaymentFormPage /> },
  { path: '/payments/:id', module: 'payments', element: <PaymentDetailPage /> },
];
