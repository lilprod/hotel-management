import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';

import { HmThemeProvider, useUiStore } from '@hm/ui';

import './i18n';
import { ModulePage } from './pages/ModulePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ShellLayout } from './components/ShellLayout';
import { modules } from './modules';

/** Keeps i18next in sync with the persisted UI language. */
function useI18nSync() {
  const language = useUiStore((s) => s.language);
  const { i18n } = useTranslation();
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
}

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  useI18nSync();

  return (
    <QueryClientProvider client={queryClient}>
      <HmThemeProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ShellLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            {modules.map((m) => (
              <Route key={m.key} path={m.path} element={<ModulePage module={m} />} />
            ))}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </HmThemeProvider>
    </QueryClientProvider>
  );
}
