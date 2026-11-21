import { formatDay, parseDay } from '../property/common.js';

const DAY_MS = 86_400_000;

/** Adds `n` days to a `YYYY-MM-DD` day. */
export function addDays(day: string, n: number): string {
  return formatDay(new Date(parseDay(day).getTime() + n * DAY_MS));
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
}

/** Nights of a stay: arrival included, departure excluded. */
export function nightsOf(arrival: string, departure: string): string[] {
  const out: string[] = [];
  for (let d = arrival; d < departure; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Calendar day of `at` in an IANA time zone (property local date). */
export function localDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export { formatDay, parseDay };
