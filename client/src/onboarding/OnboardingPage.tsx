import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Flex,
  Grid,
  Popconfirm,
  Progress,
  Skeleton,
  Steps,
  Typography,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { useApiError } from '../auth/useApiError';
import { useCan } from '../auth/useCan';
import {
  STEP_KEYS,
  TOTAL_STEPS,
  loadDemoData,
  onboardingKey,
  patchOnboarding,
  quotaOf,
  useOnboarding,
  type OnboardingView,
  type StatePatch,
} from './api';
import { markRedirected } from './redirect';
import { BrandingStep } from './steps/BrandingStep';
import type { StepSave } from './steps/common';
import { PropertyStep } from './steps/PropertyStep';
import { RatesStep } from './steps/RatesStep';
import { RecapStep } from './steps/RecapStep';
import { RoomTypesStep } from './steps/RoomTypesStep';
import { RoomsStep } from './steps/RoomsStep';
import { TaxesStep } from './steps/TaxesStep';
import { TeamStep } from './steps/TeamStep';

const LAST = TOTAL_STEPS - 1;

/** Onboarding wizard (TN-02): 8 steps, saved one by one, resumable, skippable. */
export function OnboardingPage() {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const { can } = useCan();
  const allowed = can('settings.manage');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const screens = Grid.useBreakpoint();
  const view = useOnboarding(allowed);
  const [step, setStep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wantDemo, setWantDemo] = useState(false);
  const saveRef = useRef<StepSave | null>(null);

  useEffect(() => {
    markRedirected();
  }, []);
  // Resume where the owner left.
  useEffect(() => {
    if (view.data && step === null) setStep(view.data.step);
  }, [view.data, step]);

  if (!allowed)
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert type="warning" showIcon message={t('forbidden')} />
      </>
    );
  if (view.isLoading || step === null)
    return (
      <>
        <PageHeader title={t('title')} />
        {view.isError ? (
          <Alert type="error" showIcon message={t('error')} />
        ) : (
          <Skeleton active aria-label={t('loading')} />
        )}
      </>
    );
  if (!view.data) return null;
  const data: OnboardingView = view.data;
  const propertyId = data.facts.propertyId;

  const persist = async (patch: StatePatch) => {
    const state = await patchOnboarding(patch);
    qc.setQueryData<OnboardingView>(onboardingKey, (old) => (old ? { ...old, ...state } : old));
    await qc.invalidateQueries({ queryKey: onboardingKey });
  };

  async function go(next: number, patch: StatePatch = {}) {
    setBusy(true);
    setError(null);
    try {
      await persist({ step: next, ...patch });
      setStep(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function onNext() {
    if (step === null) return;
    setBusy(true);
    setError(null);
    const ok = (await saveRef.current?.()) ?? true;
    setBusy(false);
    if (ok) await go(Math.min(step + 1, LAST), { completedSteps: [step] });
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      if (wantDemo && !data.demo.loaded) {
        try {
          await loadDemoData();
        } catch (e) {
          const q = quotaOf(e);
          setError(
            q
              ? t('rooms.quotaExceeded', { limit: q.limit ?? '?', used: q.used ?? '?' })
              : message(e),
          );
          return;
        }
      }
      await persist({ status: 'completed', completedSteps: [LAST], step: LAST });
      await qc.invalidateQueries();
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function skipWizard() {
    setBusy(true);
    try {
      await persist({ status: 'skipped' });
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const key = STEP_KEYS[step] ?? 'property';
  const percent = Math.round((step / TOTAL_STEPS) * 100);
  const common = propertyId ? { propertyId, saveRef } : null;

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Popconfirm
            title={t('skipConfirm')}
            description={t('skipConfirmText')}
            okText={t('skipWizard')}
            onConfirm={() => void skipWizard()}
          >
            <Button type="text">{t('skipWizard')}</Button>
          </Popconfirm>
        }
      />
      <Typography.Paragraph type="secondary" style={{ maxWidth: 720 }}>
        {t('subtitle')}
      </Typography.Paragraph>
      <div style={{ maxWidth: 880 }}>
        <Progress
          percent={percent}
          aria-label={t('progress')}
          format={() => `${step + 1} / ${TOTAL_STEPS}`}
        />
        {screens.md ? (
          <Steps
            size="small"
            current={step}
            style={{ margin: '16px 0 24px' }}
            items={STEP_KEYS.map((k, i) => ({
              title: t(`steps.${k}`),
              status: i < step ? 'finish' : i === step ? 'process' : 'wait',
            }))}
          />
        ) : null}
        <Card
          title={
            <>
              <span style={{ fontWeight: 400, opacity: 0.65, marginRight: 8 }}>
                {t('stepOf', { current: step + 1, total: TOTAL_STEPS })}
              </span>
              {t(`steps.${key}`)}
            </>
          }
          style={{ marginTop: screens.md ? 0 : 16 }}
        >
          {key !== 'property' && key !== 'recap' ? (
            <Typography.Paragraph type="secondary">{t(`${key}.text`)}</Typography.Paragraph>
          ) : key === 'property' ? (
            <Typography.Paragraph type="secondary">{t('property.text')}</Typography.Paragraph>
          ) : null}
          {key === 'recap' ? (
            <RecapStep view={data} wantDemo={wantDemo} onWantDemo={setWantDemo} error={error} />
          ) : !common ? (
            <Alert type="warning" showIcon message={t('error')} />
          ) : key === 'property' ? (
            <PropertyStep {...common} />
          ) : key === 'roomTypes' ? (
            <RoomTypesStep {...common} />
          ) : key === 'rooms' ? (
            <RoomsStep {...common} />
          ) : key === 'rates' ? (
            <RatesStep {...common} />
          ) : key === 'taxes' ? (
            <TaxesStep {...common} />
          ) : key === 'team' ? (
            <TeamStep {...common} />
          ) : (
            <BrandingStep {...common} />
          )}
          {error && key !== 'recap' ? (
            <Alert role="alert" type="error" showIcon message={error} style={{ marginTop: 16 }} />
          ) : null}
          <Flex justify="space-between" gap={8} wrap="wrap" style={{ marginTop: 24 }}>
            <Button disabled={step === 0 || busy} onClick={() => void go(step - 1)}>
              {t('back')}
            </Button>
            <Flex gap={8} wrap="wrap" justify="flex-end">
              <Button type="text" onClick={() => navigate('/dashboard')}>
                {t('later')}
              </Button>
              {key !== 'recap' ? (
                <Button disabled={busy} onClick={() => void go(step + 1)}>
                  {t('skipStep')}
                </Button>
              ) : null}
              {key === 'recap' ? (
                <Button type="primary" loading={busy} onClick={() => void finish()}>
                  {t('finish')}
                </Button>
              ) : (
                <Button type="primary" loading={busy} onClick={() => void onNext()}>
                  {t('next')}
                </Button>
              )}
            </Flex>
          </Flex>
        </Card>
      </div>
    </>
  );
}
