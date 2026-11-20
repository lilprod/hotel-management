import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Flex, Popconfirm, Skeleton, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useApiError } from '../auth/useApiError';
import {
  deleteDemoData,
  loadDemoData,
  onboardingKey,
  patchOnboarding,
  quotaOf,
  useOnboarding,
} from './api';

/** Settings tab: load, or delete exactly, the demonstration data (TN-03). */
export function DemoDataPanel() {
  const { t } = useTranslation(['onboarding', 'settings']);
  const message = useApiError();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const view = useOnboarding(true);
  const [note, setNote] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const refresh = () => qc.invalidateQueries();
  const load = useMutation({
    mutationFn: loadDemoData,
    onSuccess: async () => {
      setNote({ kind: 'success', text: t('onboarding:recap.demoLoaded') });
      await refresh();
    },
    onError: (e) => {
      const q = quotaOf(e);
      setNote({
        kind: 'error',
        text: q
          ? t('onboarding:rooms.quotaExceeded', { limit: q.limit ?? '?', used: q.used ?? '?' })
          : message(e),
      });
    },
  });
  const remove = useMutation({
    mutationFn: deleteDemoData,
    onSuccess: async () => {
      setNote({ kind: 'success', text: t('onboarding:demo.deleted') });
      await refresh();
    },
    onError: (e) => setNote({ kind: 'error', text: message(e) }),
  });

  if (view.isLoading) return <Skeleton active />;
  if (!view.data) return <Alert type="error" showIcon message={t('onboarding:error')} />;
  const demo = view.data.demo;

  async function restart() {
    await patchOnboarding({ status: 'in_progress', step: 0 });
    await qc.invalidateQueries({ queryKey: onboardingKey });
    navigate('/onboarding');
  }

  return (
    <Card title={t('onboarding:demo.title')} style={{ maxWidth: 720 }}>
      <Typography.Paragraph type="secondary">{t('onboarding:demo.text')}</Typography.Paragraph>
      <Flex align="center" gap={8} style={{ marginBottom: 16 }}>
        <Tag color={demo.loaded ? 'gold' : 'default'}>
          {demo.loaded ? t('onboarding:demo.loaded') : t('onboarding:demo.notLoaded')}
        </Tag>
        {demo.loaded ? (
          <Typography.Text type="secondary">
            {t('onboarding:demo.counts', { ...demo.counts })}
          </Typography.Text>
        ) : null}
      </Flex>
      {note ? (
        <Alert
          role={note.kind === 'error' ? 'alert' : 'status'}
          type={note.kind}
          showIcon
          message={note.text}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Flex gap={8} wrap="wrap">
        {demo.loaded ? (
          <Popconfirm
            title={t('onboarding:demo.deleteConfirm')}
            description={t('onboarding:demo.deleteConfirmText')}
            okButtonProps={{ danger: true }}
            okText={t('onboarding:demo.delete')}
            onConfirm={() => remove.mutate()}
          >
            <Button danger loading={remove.isPending}>
              {t('onboarding:demo.delete')}
            </Button>
          </Popconfirm>
        ) : (
          <Button type="primary" loading={load.isPending} onClick={() => load.mutate()}>
            {t('onboarding:demo.load')}
          </Button>
        )}
        <Button onClick={() => void restart()}>{t('onboarding:demo.restart')}</Button>
      </Flex>
    </Card>
  );
}
