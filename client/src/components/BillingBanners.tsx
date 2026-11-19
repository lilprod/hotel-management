import { useQuery } from '@tanstack/react-query';
import { Alert, Button } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { apiClient } from '../auth/session';
import { useCan } from '../auth/useCan';
import { SUBSCRIPTION_PATH, money, useFormatDate } from '../billing/common';
import type { Banner, BannersResponse } from '../billing/common';

/** TN-33: one banner per state (trial J-x, due soon, overdue, suspended / read-only). */
export function bannerText(
  b: Banner,
  t: (key: string, opts?: Record<string, unknown>) => string,
  fmt: { day: (iso: string | null | undefined) => string },
  currency: string,
): ReactNode {
  switch (b.kind) {
    case 'trial':
      return b.daysLeft === 0
        ? t('banner.trialToday')
        : t('banner.trial', { count: b.daysLeft, date: fmt.day(b.endsAt) });
    case 'due_soon':
      return b.daysLeft === 0
        ? t('banner.dueToday', { number: b.invoiceNumber, amount: money(b.amount, currency) })
        : t('banner.dueSoon', {
            number: b.invoiceNumber,
            amount: money(b.amount, currency),
            count: b.daysLeft,
            date: fmt.day(b.dueDate),
          });
    case 'overdue':
      return (
        t('banner.overdue', { amount: money(b.amount, currency), date: fmt.day(b.dueDate) }) +
        (b.suspensionDate ? t('banner.overdueSuspension', { date: fmt.day(b.suspensionDate) }) : '')
      );
    case 'suspended':
      return t('banner.suspended', { amount: money(b.amountDue, currency) });
    case 'cancelled':
      return t('banner.cancelled');
    case 'cancel_scheduled':
      return t('banner.cancelScheduled', { date: fmt.day(b.cancelAt) });
  }
}

/** Global banners of the shell, for the owner / `billing.manage` only. */
export function BillingBanners() {
  const { t } = useTranslation('subscription');
  const { can } = useCan();
  const navigate = useNavigate();
  const fmt = useFormatDate();
  const allowed = can('billing.manage');
  const q = useQuery({
    queryKey: ['billing', 'banners'],
    enabled: allowed,
    refetchInterval: 5 * 60_000,
    queryFn: () => apiClient.get<BannersResponse>('/billing/banners'),
  });
  if (!allowed || !q.data?.items.length) return null;
  const tt = t as unknown as Parameters<typeof bannerText>[1];
  return (
    <div role="region" aria-label={t('title')}>
      {q.data.items.map((b) => {
        const critical = b.kind === 'suspended' || b.kind === 'overdue';
        return (
          <Alert
            key={b.kind}
            banner
            type={b.severity}
            role={b.severity === 'error' ? 'alert' : 'status'}
            data-banner={b.kind}
            message={bannerText(b, tt, fmt, q.data.currency)}
            action={
              <Button
                size="small"
                type={critical ? 'primary' : 'default'}
                danger={b.kind === 'suspended'}
                onClick={() => navigate(SUBSCRIPTION_PATH)}
              >
                {critical ? t('banner.cta') : t('banner.view')}
              </Button>
            }
          />
        );
      })}
    </div>
  );
}
