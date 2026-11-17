import { Alert, Button } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStore } from '@hm/ui';

import { apiClient, endSession } from '../auth/session';

/** `exp` claim of the in-memory access token (the impersonation token expires with the session). */
function tokenExpiry(): number | null {
  const token = apiClient.getAccessToken();
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return json.exp ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Permanent banner during a support session: who, why, time left, and a way out. */
export function ImpersonationBanner() {
  const { t } = useTranslation('auth');
  const info = useSessionStore((s) => s.impersonation);
  const [now, setNow] = useState(() => Date.now());
  const [fallbackExpiry] = useState(tokenExpiry);

  useEffect(() => {
    if (!info) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [info]);

  if (!info) return null;
  const expiresAt = info.expiresAt ? Date.parse(info.expiresAt) : fallbackExpiry;
  const left = expiresAt ? expiresAt - now : null;

  return (
    <Alert
      banner
      type="warning"
      role="status"
      message={
        <>
          <strong>{t('banner.title')}</strong> — {t('banner.by', { name: info.byName ?? info.by })}
          {info.reason ? ` · ${t('banner.reason', { reason: info.reason })}` : ''}
          {left !== null
            ? ` · ${left > 0 ? t('banner.remaining', { time: formatRemaining(left) }) : t('banner.expired')}`
            : ''}
        </>
      }
      action={
        <Button
          size="small"
          onClick={() => {
            endSession();
            window.close();
          }}
        >
          {t('banner.exit')}
        </Button>
      }
    />
  );
}
