import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';

import { useUiStore } from '@hm/ui/core';

import './i18n';
import { Layout } from './components/Layout';

const HomePage = lazy(() => import('./pages/HomePage'));
const SectionPage = lazy(() => import('./pages/SectionPage'));
const BookingSearchPage = lazy(() => import('./pages/BookingSearchPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
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

  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="accommodations" element={<SectionPage section="accommodations" />} />
          <Route path="spa" element={<SectionPage section="spa" />} />
          <Route path="restaurant" element={<SectionPage section="restaurant" />} />
          <Route path="activities" element={<SectionPage section="activities" />} />
          <Route path="booking" element={<BookingSearchPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
