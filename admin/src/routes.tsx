import type { ReactElement } from 'react';

import { DashboardPage } from './pages/dashboard/DashboardPage';
import { PlatformAuditPage } from './pages/audit/PlatformAuditPage';
import { ImpersonationsPage } from './pages/impersonations/ImpersonationsPage';
import { PlatformUsersPage } from './pages/platform-users/PlatformUsersPage';

/** Page of each module key (the sidebar entry and its main route come from `modules.tsx`). */
export const pages: Record<string, ReactElement> = {
  dashboard: <DashboardPage />,
  'platform-users': <PlatformUsersPage />,
  impersonations: <ImpersonationsPage />,
  audit: <PlatformAuditPage />,
};

/** Detail / creation routes that are not sidebar entries; they inherit the module's permission. */
export const subRoutes: { path: string; module: string; element: ReactElement }[] = [];
