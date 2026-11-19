import type { ReactElement } from 'react';

import { DashboardPage } from './pages/dashboard/DashboardPage';
import { PlatformAuditPage } from './pages/audit/PlatformAuditPage';
import { ImpersonationsPage } from './pages/impersonations/ImpersonationsPage';
import { DeclarationsPage } from './pages/declarations/DeclarationsPage';
import { InvoiceDetailPage } from './pages/invoices/InvoiceDetailPage';
import { InvoicesPage } from './pages/invoices/InvoicesPage';
import { PlansPage } from './pages/plans/PlansPage';
import { PaymentDetailPage } from './pages/payments/PaymentDetailPage';
import { PaymentFormPage } from './pages/payments/PaymentFormPage';
import { PaymentsPage } from './pages/payments/PaymentsPage';
import { TenantCreatePage } from './pages/tenants/TenantCreatePage';
import { TenantDetailPage } from './pages/tenants/TenantDetailPage';
import { TenantsPage } from './pages/tenants/TenantsPage';
import { PlatformUsersPage } from './pages/platform-users/PlatformUsersPage';

/** Page of each module key (the sidebar entry and its main route come from `modules.tsx`). */
export const pages: Record<string, ReactElement> = {
  dashboard: <DashboardPage />,
  payments: <PaymentsPage />,
  plans: <PlansPage />,
  invoices: <InvoicesPage />,
  'payment-declarations': <DeclarationsPage />,
  tenants: <TenantsPage />,
  'platform-users': <PlatformUsersPage />,
  impersonations: <ImpersonationsPage />,
  audit: <PlatformAuditPage />,
};

/** Detail / creation routes that are not sidebar entries; they inherit the module's permission. */
export const subRoutes: { path: string; module: string; element: ReactElement }[] = [
  { path: '/tenants/new', module: 'tenants', element: <TenantCreatePage /> },
  { path: '/tenants/:id', module: 'tenants', element: <TenantDetailPage /> },
  { path: '/invoices/:id', module: 'invoices', element: <InvoiceDetailPage /> },
  { path: '/payments/new', module: 'payments', element: <PaymentFormPage /> },
  { path: '/payments/:id', module: 'payments', element: <PaymentDetailPage /> },
];
