import { z } from 'zod';
import { defineSetting } from '../../core/settings.js';

const scopes = ['PLATFORM', 'TENANT', 'PROPERTY'] as const;
const policy = z.enum(['WARN', 'BLOCK']);

export const autoSchema = z.object({
  enabled: z.boolean(),
  /** Local time of the property (`HH:MM`, property time zone). */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Arrivals still expected: block the automatic run, keep them, or mark them no-show. */
  pendingArrivals: z.enum(['BLOCK', 'KEEP', 'NO_SHOW']),
});
export type AutoSettings = z.infer<typeof autoSchema>;

/** Night audit settings (hierarchy PROPERTY > TENANT > PLATFORM > default). */
export const nightAuditSettings = {
  departuresPolicy: defineSetting({
    key: 'night_audit.departures_policy',
    schema: policy,
    default: 'WARN' as 'WARN' | 'BLOCK',
    scopes,
    description: 'Departures of the day not checked out: warn only, or block the night audit',
  }),
  cashSessionsPolicy: defineSetting({
    key: 'night_audit.cash_sessions_policy',
    schema: policy,
    default: 'WARN' as 'WARN' | 'BLOCK',
    scopes,
    description: 'Cash sessions still open: warn only, or block the night audit',
  }),
  auto: defineSetting({
    key: 'night_audit.auto',
    schema: autoSchema,
    default: { enabled: false, time: '03:00', pendingArrivals: 'BLOCK' } as AutoSettings,
    scopes,
    description:
      'Automatic night audit at a local time of the property; runs only when the pre-checks do not block, otherwise the managers are notified',
  }),
};
