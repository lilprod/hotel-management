import type { TFunction } from 'i18next';

import { conflictDetails, formatDayShort } from './api';
import type { PlanningData } from './api';

/**
 * Human-readable lines of a 409 (`meta.clashes` per unit / `meta.short` per room type), one line
 * per room (or type) with the clashing nights, e.g. "Chambre 104 : 12/11, 13/11 (occupée)".
 */
export function conflictLines(
  err: unknown,
  t: TFunction,
  data: PlanningData | undefined,
  locale: string,
): string[] {
  const d = conflictDetails(err);
  if (!d) return [];
  const roomNumber = new Map<string, string>();
  const typeName = new Map<string, string>();
  for (const type of data?.roomTypes ?? []) {
    typeName.set(type.id, type.name);
    for (const r of type.rooms) roomNumber.set(r.id, r.number);
  }
  const lines: string[] = [];
  const byRoom = new Map<string, { reason: string; nights: string[] }>();
  for (const c of d.clashes) {
    const key = `${c.roomId}|${c.reason}`;
    const entry = byRoom.get(key) ?? { reason: c.reason, nights: [] };
    entry.nights.push(formatDayShort(c.date, locale));
    byRoom.set(key, entry);
  }
  for (const [key, e] of byRoom) {
    const roomId = key.split('|')[0] ?? '';
    lines.push(
      t('conflict.unit', {
        room: roomNumber.get(roomId) ?? '?',
        nights: e.nights.join(', '),
        reason: t(`conflict.reason.${e.reason}`, { defaultValue: e.reason }),
      }),
    );
  }
  const byType = new Map<string, string[]>();
  for (const s of d.short) {
    const list = byType.get(s.roomTypeId) ?? [];
    list.push(formatDayShort(s.date, locale));
    byType.set(s.roomTypeId, list);
  }
  for (const [typeId, nights] of byType)
    lines.push(
      t('conflict.short', { type: typeName.get(typeId) ?? '?', nights: nights.join(', ') }),
    );
  return lines;
}
