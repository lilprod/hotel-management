/** Quota keys (doc 02 §1). Checked at creation time only, never retroactively. */
export const QUOTA_KEYS = ['properties', 'units', 'users', 'storage_mb', 'sms_per_month'] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];

/** `null` means unlimited. */
export type QuotaValue = number | null;
export type QuotaSet = Record<QuotaKey, QuotaValue>;
