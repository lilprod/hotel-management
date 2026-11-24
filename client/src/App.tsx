import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useSessionStore, useUiStore } from '@hm/ui';

import './i18n';
import { Guard } from './auth/guards';
import { bootstrapSession } from './auth/session';
import { ShellLayout } from './components/ShellLayout';
import { TenantThemeProvider } from './components/TenantTheme';
import { modules } from './modules';
import { AccountPage } from './pages/account/AccountPage';
import { LegalPage } from './pages/auth/LegalPage';
import { LoginPage } from './pages/auth/LoginPage';
import {
  AcceptInvitePage,
  ChangePasswordPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from './pages/auth/PasswordForms';
import { DashboardPage } from './onboarding/DashboardPage';
import { OnboardingPage } from './onboarding/OnboardingPage';
import { ModulePage } from './pages/ModulePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { FrontDeskPage } from './pages/front-desk/FrontDeskPage';
import { PoliceRegisterPage } from './pages/front-desk/PoliceRegisterPage';
import { GroupsPage } from './reservations/GroupsPage';
import { PlanningPage } from './reservations/PlanningPage';
import { NewReservationPage, ReservationsPage } from './reservations/ReservationsPage';
import { WaitlistPage } from './reservations/WaitlistPage';
import { SecurityPage } from './pages/security/SecurityPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { CheckEmailPage } from './signup/CheckEmailPage';
import { LandingPage } from './signup/LandingPage';
import { SignupFormPage } from './signup/SignupFormPage';
import { VerifyPage } from './signup/VerifyPage';
import { SubscriptionPage } from './pages/subscription/SubscriptionPage';

/** Keeps i18next in sync with the persisted UI language. */
function useI18nSync() {
  const language = useUiStore((s) => s.language);
  const { i18n } = useTranslation();
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
}

function moduleElement(m: (typeof modules)[number]) {
  const guard = { permission: m.requiredPermission, feature: m.requiredFeature };
  if (m.key === 'dashboard') return <DashboardPage />;
  if (m.key === 'settings')
    return (
      <Guard {...guard}>
        <SettingsPage />
      </Guard>
    );
  if (m.key === 'security')
    return (
      <Guard {...guard}>
        <SecurityPage />
      </Guard>
    );
  if (m.key === 'reservations')
    return (
      <Guard {...guard}>
        <ReservationsPage />
      </Guard>
    );
  if (m.key === 'calendar')
    return (
      <Guard {...guard}>
        <PlanningPage />
      </Guard>
    );
  if (m.key === 'waitlist')
    return (
      <Guard {...guard}>
        <WaitlistPage />
      </Guard>
    );
  if (m.key === 'groups')
    return (
      <Guard {...guard}>
        <GroupsPage />
      </Guard>
    );
  if (m.key === 'front-desk')
    return (
      <Guard {...guard}>
        <FrontDeskPage />
      </Guard>
    );
  if (m.key === 'subscription')
    return (
      <Guard {...guard}>
        <SubscriptionPage />
      </Guard>
    );
  return <ModulePage module={m} />;
}

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  useI18nSync();

  // First load: silent refresh from the cookie (or support hand-off), then /auth/me.
  useEffect(() => {
    if (useSessionStore.getState().status === 'unknown') void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TenantThemeProvider>
        <Routes>
          {/* Public pages of the platform host: landing, signup, e-mail verification (TN-01). */}
          <Route path="/signup" element={<LandingPage />} />
          <Route path="/signup/new" element={<SignupFormPage />} />
          <Route path="/signup/check-email" element={<CheckEmailPage />} />
          <Route path="/signup/verify" element={<VerifyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route
            path="/change-password"
            element={
              <Guard allowWhilePending>
                <ChangePasswordPage />
              </Guard>
            }
          />
          <Route
            path="/legal"
            element={
              <Guard allowWhilePending>
                <LegalPage />
              </Guard>
            }
          />
          <Route
            element={
              <Guard>
                <ShellLayout />
              </Guard>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route
              path="/reservations/new"
              element={
                <Guard permission="reservations.create">
                  <NewReservationPage />
                </Guard>
              }
            />
            <Route
              path="/front-desk/police-register"
              element={
                <Guard permission="front_desk.police_form">
                  <PoliceRegisterPage />
                </Guard>
              }
            />
            {modules.map((m) => (
              <Route
                key={m.key}
                path={m.key === 'security' ? `${m.path}/:tab?` : m.path}
                element={moduleElement(m)}
              />
            ))}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </TenantThemeProvider>
    </QueryClientProvider>
  );
}
