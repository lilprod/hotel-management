import { Alert, Form, Input, Modal, Tag } from 'antd';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { saveBlob } from '@hm/ui';

import { apiClient } from '../auth/session';
import { useApiError } from '../auth/useApiError';
import type { InvoiceStatus, PayMethod, PaymentStatus, SubStatus } from './common';

const INVOICE_COLORS: Record<InvoiceStatus, string> = {
  DRAFT: 'default',
  ISSUED: 'blue',
  PARTIALLY_PAID: 'orange',
  PAID: 'green',
  OVERDUE: 'red',
  VOID: 'default',
};

/** `ISSUED` is displayed "Ouverte". */
export function InvoiceStatusTag({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation('billing');
  return (
    <Tag color={INVOICE_COLORS[status]} data-status={status}>
      {t(`invoiceStatus.${status}`)}
    </Tag>
  );
}

const PAYMENT_COLORS: Record<PaymentStatus, string> = {
  PENDING_VALIDATION: 'gold',
  CONFIRMED: 'green',
  REVERSED: 'red',
};

export function PaymentStatusTag({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation('billing');
  return (
    <Tag color={PAYMENT_COLORS[status]} data-status={status}>
      {t(`paymentStatus.${status}`)}
    </Tag>
  );
}

const SUB_COLORS: Record<SubStatus, string> = {
  TRIALING: 'cyan',
  ACTIVE: 'green',
  PAST_DUE: 'orange',
  SUSPENDED: 'red',
  CANCELLED: 'default',
};

export function SubStatusTag({ status }: { status: SubStatus }) {
  const { t } = useTranslation('billing');
  return (
    <Tag color={SUB_COLORS[status]} data-status={status}>
      {t(`subStatus.${status}`)}
    </Tag>
  );
}

export function useMethodLabel() {
  const { t } = useTranslation('billing');
  return (m: PayMethod | string) => t(`method.${m}`, { defaultValue: m });
}

interface ReasonModalProps {
  title: ReactNode;
  description?: ReactNode;
  okText: string;
  danger?: boolean;
  /** Extra form controls rendered above the reason. */
  children?: ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}

/** Modal asking for a mandatory reason (≥ 3 characters, as the API requires) before a sensitive action. */
export function ReasonModal({
  title,
  description,
  okText,
  danger,
  children,
  onSubmit,
  onClose,
}: ReasonModalProps) {
  const { t } = useTranslation('billing');
  const message = useApiError();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 3) {
      setError(t('reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={title}
      okText={okText}
      cancelText={t('cancel')}
      okButtonProps={{ danger: danger ?? false }}
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      {description ? <p>{description}</p> : null}
      <Form layout="vertical" component={false}>
        {children}
        <Form.Item label={t('reason')} htmlFor="reason-input" required>
          <Input.TextArea
            id="reason-input"
            rows={3}
            maxLength={1000}
            value={reason}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
    </Modal>
  );
}

/** Authenticated CSV (or other file) download through the API client. */
export async function downloadFile(path: string): Promise<void> {
  const { blob, filename } = await apiClient.download(path);
  saveBlob(blob, filename);
}

/** Opens a short-lived signed URL (PDF) in a new tab. */
export function openUrl(url: string | null | undefined): void {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}
