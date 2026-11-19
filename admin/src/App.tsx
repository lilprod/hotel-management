import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';

import { HmThemeProvider, useSessionStore, useUiStore } from '@hm/ui';

import './i18n';
import { Guard } from './auth/guards';
import { bootstrapSession } from './auth/session';
import { ModulePage } from './pages/ModulePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ShellLayout } from './components/ShellLayout';
import { modules } from './modules';
import { pages, subRoutes } from './routes';

/** Keeps i18next in sync with the persisted UI language. */
function useI18nSync() {
  const language = useUiStore((s) => s.language);
  const { i18n } = useTranslation();
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
}

function moduleElement(m: (typeof modules)[number]) {
  const page = pages[m.key];
  return page ? (
    <Guard permission={m.requiredPermission} feature={m.requiredFeature}>
      {page}
    </Guard>
  ) : (
    <ModulePage module={m} />
  );
}

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  useI18nSync();

  // First load: silent refresh from the cookie, then /auth/me.
  useEffect(() => {
    if (useSessionStore.getState().status === 'unknown') void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <HmThemeProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <Guard>
                <ShellLayout />
              </Guard>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            {modules.map((m) => (
              <Route key={m.key} path={m.path} element={moduleElement(m)} />
            ))}
            {subRoutes.map((r) => {
              const m = modules.find((x) => x.key === r.module);
              return (
                <Route
                  key={r.path}
                  path={r.path}
                  element={
                    <Guard permission={m?.requiredPermission} feature={m?.requiredFeature}>
                      {r.element}
                    </Guard>
                  }
                />
              );
            })}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </HmThemeProvider>
    </QueryClientProvider>
  );
}
