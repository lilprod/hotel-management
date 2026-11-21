/** Pure helpers of the ResourceTimeline (dates, slots, row layout). No DOM, no React. */

const DAY_MS = 86_400_000;

/** UTC milliseconds of the day part (`YYYY-MM-DD`) of a date or datetime string. */
export function dayMs(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return formatDay(dayMs(day) + n * DAY_MS);
}

export function diffDays(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** Day of week (0 = Sunday) of a `YYYY-MM-DD` day. */
export function weekday(day: string): number {
  return new Date(dayMs(day)).getUTCDay();
}

/** Position of a date / `YYYY-MM-DDTHH:mm` value in slots from `from` (may be fractional or out of range). */
export function toSlot(value: string, from: string, slotsPerDay: number): number {
  const days = diffDays(from, value);
  if (slotsPerDay === 1 || value.length <= 10) return days * slotsPerDay;
  const minutes = Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  return days * slotsPerDay + minutes / (1440 / slotsPerDay);
}

/** Inverse of `toSlot` for integer slots: a day string (1 slot per day) or `YYYY-MM-DDTHH:mm`. */
export function fromSlot(slot: number, from: string, slotsPerDay: number): string {
  const day = Math.floor(slot / slotsPerDay);
  const date = addDays(from, day);
  if (slotsPerDay === 1) return date;
  const minutes = Math.round((slot - day * slotsPerDay) * (1440 / slotsPerDay));
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${date}T${hh}:${mm}`;
}

export interface RowResource {
  id: string;
  group?: string | undefined;
}
export interface RowGroup {
  id: string;
}

export interface RowLayout<R extends RowResource = RowResource> {
  kind: 'group' | 'resource';
  key: string;
  top: number;
  height: number;
  groupId?: string | undefined;
  resource?: R;
}

/**
 * Vertical layout: group header rows followed by their resources (collapsed groups keep only
 * the header). Resources without a (known) group come first, without header.
 */
export function buildRows<R extends RowResource>(
  resources: readonly R[],
  groups: readonly RowGroup[],
  rowHeight: number,
  groupHeight: number,
  collapsed: ReadonlySet<string> = new Set(),
): { rows: RowLayout<R>[]; total: number } {
  const known = new Set(groups.map((g) => g.id));
  const byGroup = new Map<string, R[]>();
  const loose: R[] = [];
  for (const r of resources) {
    if (r.group && known.has(r.group)) {
      const list = byGroup.get(r.group) ?? [];
      list.push(r);
      byGroup.set(r.group, list);
    } else loose.push(r);
  }
  const rows: RowLayout<R>[] = [];
  let top = 0;
  const push = (row: Omit<RowLayout<R>, 'top'>) => {
    rows.push({ ...row, top });
    top += row.height;
  };
  for (const r of loose)
    push({ kind: 'resource', key: r.id, height: rowHeight, resource: r, groupId: undefined });
  for (const g of groups) {
    const list = byGroup.get(g.id) ?? [];
    if (!list.length) continue;
    push({ kind: 'group', key: `g:${g.id}`, height: groupHeight, groupId: g.id });
    if (collapsed.has(g.id)) continue;
    for (const r of list)
      push({ kind: 'resource', key: r.id, height: rowHeight, resource: r, groupId: g.id });
  }
  return { rows, total: top };
}

/** Index of the row containing `y` (clamped to the first / last row), -1 when there is no row. */
export function rowIndexAt(rows: readonly { top: number; height: number }[], y: number): number {
  if (!rows.length) return -1;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid]!.top <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Visible window of rows `[first, last]` for a vertical viewport, with overscan. */
export function rowWindow(
  rows: readonly { top: number; height: number }[],
  scrollTop: number,
  height: number,
  overscan = 4,
): [number, number] {
  if (!rows.length) return [0, -1];
  const first = Math.max(0, rowIndexAt(rows, scrollTop) - overscan);
  const last = Math.min(rows.length - 1, rowIndexAt(rows, scrollTop + height) + overscan);
  return [first, last];
}

/** Visible window of slots `[first, last)` for a horizontal viewport, with overscan. */
export function slotWindow(
  scrollStart: number,
  width: number,
  labelWidth: number,
  cellWidth: number,
  slots: number,
  overscan = 3,
): [number, number] {
  const first = Math.max(0, Math.floor((scrollStart - labelWidth) / cellWidth) - overscan);
  const last = Math.min(
    slots,
    Math.ceil((scrollStart + width - labelWidth) / cellWidth) + overscan,
  );
  return [first, Math.max(first, last)];
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
