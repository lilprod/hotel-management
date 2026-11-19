import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useCan } from '../auth/useCan';
import { SUBSCRIPTION_PATH } from '../billing/common';
import { useSuspendedStore } from '../billing/suspended';

/** Read-only mode: a write was refused with SUBSCRIPTION_SUSPENDED; points to the Abonnement page. */
export function SuspendedModal() {
  const { t } = useTranslation('subscription');
  const { can } = useCan();
  const navigate = useNavigate();
  const open = useSuspendedStore((s) => s.open);
  const close = useSuspendedStore((s) => s.close);
  const canPay = can('billing.manage');
  return (
    <Modal
      open={open}
      title={t('suspended.title')}
      okText={canPay ? t('suspended.go') : t('suspended.close')}
      cancelText={t('suspended.close')}
      cancelButtonProps={canPay ? {} : { style: { display: 'none' } }}
      onOk={() => {
        close();
        if (canPay) navigate(SUBSCRIPTION_PATH);
      }}
      onCancel={close}
    >
      <p>{canPay ? t('suspended.body') : t('suspended.bodyOther')}</p>
    </Modal>
  );
}
