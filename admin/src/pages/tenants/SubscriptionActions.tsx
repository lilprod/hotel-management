import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Form, InputNumber, Modal, Select, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { CYCLES } from '../../billing/common';
import type { Cycle } from '../../billing/common';
import type { TenantDetail } from '../../billing/models';
import { ReasonModal, openUrl } from '../../billing/ui';
import { usePlans } from './TenantsPage';

type Action = 'plan' | 'offer' | 'suspend' | 'reactivate' | 'cancel';

function ChangePlanModal({
  tenant,
  onDone,
  onClose,
}: {
  tenant: TenantDetail;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('ten');
  const { t: tb } = useTranslation('billing');
  const errorText = useApiError();
  const plans = usePlans();
  const sub = tenant.subscription;
  const [planId, setPlanId] = useState<string | undefined>(sub?.plan.id);
  const [cycle, setCycle] = useState<Cycle>(sub?.billingCycle ?? 'MONTHLY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!planId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiClient.post<{ mode?: 'immediate' | 'scheduled'; effectiveAt?: string }>(
        `/tenants/${tenant.id}/plan`,
        { planId, billingCycle: cycle },
      );
      void message.success(
        r?.mode === 'scheduled'
          ? t('actions.planScheduled', { date: r.effectiveAt })
          : t('actions.planChanged'),
      );
      await onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={t('actions.plan')}
      okText={tb('confirm')}
      cancelText={tb('cancel')}
      okButtonProps={{ disabled: !planId }}
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <p>{t('actions.planHint')}</p>
      <Form layout="vertical" component={false}>
        <Form.Item label={t('plan')} htmlFor="cp-plan">
          <Select
            id="cp-plan"
            value={planId}
            onChange={setPlanId}
            options={(plans.data?.items ?? [])
              .filter((p) => p.isActive)
              .map((p) => ({ value: p.id, label: p.name }))}
          />
        </Form.Item>
        <Form.Item label={t('cycle')} htmlFor="cp-cycle">
          <Select
            id="cp-cycle"
            value={cycle}
            onChange={setCycle}
            options={CYCLES.map((c) => ({ value: c, label: tb(`cycle.${c}`) }))}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon role="alert" message={error} /> : null}
    </Modal>
  );
}

function OfferDaysModal({
  id,
  onDone,
  onClose,
}: {
  id: string;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('ten');
  const [days, setDays] = useState<number | null>(7);
  return (
    <ReasonModal
      title={t('actions.offer')}
      description={t('actions.offerHint')}
      okText={t('actions.offerOk')}
      onSubmit={async (reason) => {
        if (!days || days < 1) throw new Error('days');
        await apiClient.post(`/tenants/${id}/offer-days`, { days, reason });
        await onDone();
      }}
      onClose={onClose}
    >
      <Form.Item label={t('actions.days')} htmlFor="offer-days" required>
        <InputNumber
          id="offer-days"
          min={1}
          max={365}
          precision={0}
          value={days}
          onChange={setDays}
        />
      </Form.Item>
    </ReasonModal>
  );
}

function CancelModal({
  id,
  onDone,
  onClose,
}: {
  id: string;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('ten');
  const [atPeriodEnd, setAtPeriodEnd] = useState(false);
  return (
    <ReasonModal
      danger
      title={t('actions.cancel')}
      description={atPeriodEnd ? t('actions.cancelEndHint') : t('actions.cancelNowHint')}
      okText={t('actions.cancelOk')}
      onSubmit={async (reason) => {
        await apiClient.post(`/tenants/${id}/cancel`, { reason, atPeriodEnd });
        await onDone();
      }}
      onClose={onClose}
    >
      <Form.Item>
        <Checkbox checked={atPeriodEnd} onChange={(e) => setAtPeriodEnd(e.target.checked)}>
          {t('actions.atPeriodEnd')}
        </Checkbox>
      </Form.Item>
    </ReasonModal>
  );
}

/** Subscription actions of a tenant (SUPER_ADMIN only): plan, offered days, suspend, reactivate, cancel, export. */
export function SubscriptionActions({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation('ten');
  const errorText = useApiError();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState<'export' | 'pending' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = tenant.subscription?.status;
  const done = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['tenant', tenant.id] }),
      qc.invalidateQueries({ queryKey: ['tenants'] }),
    ]);
  };
  const run = async (kind: 'export' | 'pending') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'export') {
        const r = await apiClient.post<{ url: string | null }>(`/tenants/${tenant.id}/export`);
        openUrl(r.url);
      } else {
        await apiClient.delete(`/tenants/${tenant.id}/plan/pending`);
        await done();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const close = () => setAction(null);
  return (
    <>
      <Button onClick={() => setAction('plan')} disabled={!tenant.subscription}>
        {t('actions.plan')}
      </Button>
      {tenant.subscription?.pendingChange ? (
        <Button loading={busy === 'pending'} onClick={() => void run('pending')}>
          {t('actions.cancelPending')}
        </Button>
      ) : null}
      <Button onClick={() => setAction('offer')} disabled={!tenant.subscription}>
        {t('actions.offer')}
      </Button>
      {status === 'SUSPENDED' ? (
        <Button type="primary" onClick={() => setAction('reactivate')}>
          {t('actions.reactivate')}
        </Button>
      ) : status && status !== 'CANCELLED' ? (
        <Button danger onClick={() => setAction('suspend')}>
          {t('actions.suspend')}
        </Button>
      ) : null}
      {status && status !== 'CANCELLED' ? (
        <Button danger onClick={() => setAction('cancel')}>
          {t('actions.cancel')}
        </Button>
      ) : null}
      <Button loading={busy === 'export'} onClick={() => void run('export')}>
        {t('actions.export')}
      </Button>
      {error ? <Alert type="error" showIcon role="alert" message={error} closable /> : null}
      {action === 'plan' ? <ChangePlanModal tenant={tenant} onDone={done} onClose={close} /> : null}
      {action === 'offer' ? <OfferDaysModal id={tenant.id} onDone={done} onClose={close} /> : null}
      {action === 'cancel' ? <CancelModal id={tenant.id} onDone={done} onClose={close} /> : null}
      {action === 'suspend' || action === 'reactivate' ? (
        <ReasonModal
          danger={action === 'suspend'}
          title={t(`actions.${action}`)}
          description={t(`actions.${action}Hint`)}
          okText={t(`actions.${action}`)}
          onSubmit={async (reason) => {
            await apiClient.post(`/tenants/${tenant.id}/${action}`, { reason });
            await done();
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}
