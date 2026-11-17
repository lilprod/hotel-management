/** Drops empty strings / undefined so optional API fields are omitted rather than invalid. */
export function clean<T extends Record<string, unknown>>(v: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(v).filter(([, x]) => x !== '' && x !== undefined && x !== null),
  ) as Partial<T>;
}

export const DOW_ALL = 127;
/** Friday + Saturday nights (bit i = day i, 0 = Sunday). */
export const DOW_WEEKEND = (1 << 5) | (1 << 6);

export const formatMoney = (n: number, currency = 'XOF'): string =>
  `${new Intl.NumberFormat('fr-FR').format(n)} ${currency}`;
