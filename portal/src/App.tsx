import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';

import { useSessionStore, useUiStore } from '@hm/ui/core';

import './i18n';
import { bootstrapSession } from './auth/session';
import { BrandingProvider } from './branding';
import { Layout } from './components/Layout';
import { RequireAccount } from './pages/auth/AuthPages';

const HomePage = lazy(() => import('./pages/HomePage'));
const SectionPage = lazy(() => import('./pages/SectionPage'));
const BookingSearchPage = lazy(() => import('./pages/BookingSearchPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const lazyAuth = <K extends string>(name: K) =>
  lazy(() =>
    import('./pages/auth/AuthPages').then((m) => ({
      default: (m as unknown as Record<K, React.ComponentType>)[name],
    })),
  );
const LoginPage = lazyAuth('LoginPage');
const RegisterPage = lazyAuth('RegisterPage');
const VerifyEmailPage = lazyAuth('VerifyEmailPage');
const ForgotPasswordPage = lazyAuth('ForgotPasswordPage');
const ResetPasswordPage = lazyAuth('ResetPasswordPage');

const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

/** Keeps i18next and the document language in sync with the persisted UI language. */
function useLanguageSync() {
  const language = useUiStore((s) => s.language);
  const { i18n } = useTranslation();
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language, i18n]);
}

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  useLanguageSync();

  // First load: silent refresh from the guest cookie, then /auth/me.
  useEffect(() => {
    if (useSessionStore.getState().status === 'unknown') void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="accommodations" element={<SectionPage section="accommodations" />} />
            <Route path="spa" element={<SectionPage section="spa" />} />
            <Route path="restaurant" element={<SectionPage section="restaurant" />} />
            <Route path="activities" element={<SectionPage section="activities" />} />
            <Route path="booking" element={<BookingSearchPage />} />
            <Route
              path="account"
              element={
                <RequireAccount>
                  <AccountPage />
                </RequireAccount>
              }
            />
            <Route path="account/login" element={<LoginPage />} />
            <Route path="account/register" element={<RegisterPage />} />
            <Route path="account/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="account/reset-password" element={<ResetPasswordPage />} />
            <Route path="verify-email" element={<VerifyEmailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrandingProvider>
    </QueryClientProvider>
  );
}
