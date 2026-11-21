import { theme } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusTag, readableTextColor } from '@hm/ui';
import type { TimelineColor } from '@hm/ui';

/** Colors of the planning segments (per `colorKey`), derived from antd tokens (dark mode ready). */
export function usePlanningColors(): Record<string, TimelineColor> {
  const { token } = theme.useToken();
  return useMemo(() => {
    const c = (bg: string): TimelineColor => ({ bg, fg: readableTextColor(bg) });
    return {
      pending: c(token.colorWarning),
      confirmed: c(token.colorInfo),
      checked_in: c(token.colorSuccess),
      checked_out: c(token.colorTextTertiary),
      completed: c(token.colorTextTertiary),
      group: c('#722ed1'),
      allotment: c('#8c6bb1'),
    };
  }, [token]);
}

const LEGEND_KEYS = ['pending', 'confirmed', 'checked_in', 'checked_out', 'group', 'allotment'];

export function StatusLegend() {
  const { t } = useTranslation('reservations');
  const colors = usePlanningColors();
  const { token } = theme.useToken();
  return (
    <ul
      aria-label={t('legend.title')}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 14px',
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {LEGEND_KEYS.map((k) => (
        <li key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: colors[k]?.bg,
              display: 'inline-block',
            }}
          />
          {t(`legend.${k}`)}
        </li>
      ))}
      <li style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            display: 'inline-block',
            border: `1px solid ${token.colorTextQuaternary}`,
            backgroundImage: `repeating-linear-gradient(135deg, ${token.colorTextQuaternary} 0 2px, transparent 2px 5px)`,
          }}
        />
        {t('legend.blocked')}
      </li>
    </ul>
  );
}

/** Status tag of a reservation (translated, never color alone). */
export function ReservationStatusTag({ status }: { status: string }) {
  const { t } = useTranslation('reservations');
  return (
    <StatusTag
      status={status.toLowerCase()}
      label={t(`status.${status}`, { defaultValue: status })}
      colors={{ completed: 'default' }}
    />
  );
}
