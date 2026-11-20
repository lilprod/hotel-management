import { CheckCircleFilled, RightCircleOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Flex, List, Progress, Tag, Typography, theme } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { checklistOf, onboardingKey, patchOnboarding, type OnboardingView } from './api';

const STEP_OF = {
  property: 0,
  roomTypes: 1,
  rooms: 2,
  rates: 3,
  taxes: 4,
  team: 5,
  branding: 6,
} as const;

/** Dashboard card "Terminer la configuration": shown until the wizard is completed. */
export function ChecklistCard({ view }: { view: OnboardingView }) {
  const { t } = useTranslation('onboarding');
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const done = checklistOf(view);
  const entries = Object.entries(done) as [keyof typeof done, boolean][];
  const count = entries.filter(([, v]) => v).length;

  async function resume(step?: number) {
    setBusy(true);
    try {
      await patchOnboarding({ status: 'in_progress', ...(step !== undefined ? { step } : {}) });
      await qc.invalidateQueries({ queryKey: onboardingKey });
      navigate('/onboarding');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      data-testid="onboarding-checklist"
      style={{ marginBottom: 24, borderColor: token.colorPrimaryBorder }}
      title={
        <Flex align="center" gap={8} wrap>
          <span>{t('checklist.title')}</span>
          {view.status === 'skipped' ? <Tag>{t('checklist.dismissed')}</Tag> : null}
        </Flex>
      }
      extra={
        <Button type="primary" loading={busy} onClick={() => void resume()}>
          {t('checklist.resume')}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        {t('checklist.text', { done: count, total: entries.length })}
      </Typography.Paragraph>
      <Progress
        percent={Math.round((count / entries.length) * 100)}
        aria-label={t('progress')}
        showInfo={false}
      />
      <List
        size="small"
        dataSource={entries}
        renderItem={([key, ok]) => (
          <List.Item
            actions={
              ok
                ? []
                : [
                    <Button
                      key="go"
                      type="link"
                      size="small"
                      aria-label={`${t('checklist.go')} : ${t('checklist.items.' + key)}`}
                      onClick={() => void resume(STEP_OF[key])}
                    >
                      <RightCircleOutlined aria-hidden /> {t('checklist.go')}
                    </Button>,
                  ]
            }
          >
            {ok ? (
              <span>
                <CheckCircleFilled
                  style={{ color: token.colorSuccess, marginRight: 8 }}
                  aria-hidden
                />
                <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>
                  {t('checklist.items.' + key)}
                </span>
              </span>
            ) : (
              <span style={{ opacity: 0.75 }}>{t('checklist.items.' + key)}</span>
            )}
          </List.Item>
        )}
      />
    </Card>
  );
}
