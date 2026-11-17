import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Collapse, Flex, Spin } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';

import { useSessionStore } from '@hm/ui';

import { apiClient, loadMe, logout, useMeStore } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { AuthLayout } from '../../components/AuthLayout';

interface LegalDoc {
  id: string;
  type: string;
  version: string;
  locale: string;
  publishedAt: string;
  content: string;
  accepted: boolean;
}

/**
 * Versioned TOS / DPA acceptance (EX-04). The whole staff API is blocked until the owner accepts;
 * other users see the documents and who must accept.
 */
export function LegalPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const message = useApiError();
  const blocked = useSessionStore((s) => s.legalBlocked);
  const me = useMeStore((s) => s.me);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docs = useQuery({
    queryKey: ['legal-documents'],
    queryFn: () => apiClient.get<{ items: LegalDoc[] }>('/legal/documents'),
  });

  if (!blocked) return <Navigate to="/dashboard" replace />;
  const canAccept = me?.legal.canAccept ?? false;
  const pending = (docs.data?.items ?? []).filter((d) => !d.accepted);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/legal/accept', { documentIds: pending.map((d) => d.id) });
      await loadMe();
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('legal.title')} subtitle={t('legal.subtitle')} width={720}>
      {docs.isPending ? (
        <Spin />
      ) : docs.isError ? (
        <Alert type="error" showIcon message={message(docs.error)} role="alert" />
      ) : (
        <Flex vertical gap={16}>
          <Collapse
            defaultActiveKey={pending.slice(0, 1).map((d) => d.id)}
            items={(docs.data?.items ?? []).map((d) => ({
              key: d.id,
              label: `${t(`legal.type.${d.type}`, { defaultValue: d.type })} — v${d.version}`,
              children: (
                <div
                  aria-label={`${d.type} v${d.version}`}
                  style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                >
                  {d.content}
                </div>
              ),
            }))}
          />
          {canAccept ? (
            <>
              <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>
                {t('legal.confirm')}
              </Checkbox>
              {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
              <Button
                type="primary"
                disabled={!checked || pending.length === 0}
                loading={busy}
                onClick={() => void accept()}
              >
                {t('legal.accept')}
              </Button>
            </>
          ) : (
            <Alert type="warning" showIcon message={t('legal.ownerOnly')} />
          )}
          <Button
            type="link"
            style={{ padding: 0, alignSelf: 'flex-start' }}
            onClick={() => void logout()}
          >
            {t('change.logout')}
          </Button>
        </Flex>
      )}
    </AuthLayout>
  );
}
