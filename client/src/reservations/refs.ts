import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { get, qs } from './api';
import type { CustomFieldDef, LookupValue, RatePlan } from './api';

/** Referential data of the reservation screens (cached, shared by every page). */

const STALE = 5 * 60_000;

export interface RoomTypeRef {
  id: string;
  code: string;
  name: string;
  /** Translations {locale: label}; `name` is the tenant default locale. */
  nameI18n?: Record<string, string> | null;
  maxAdults?: number;
  maxChildren?: number;
}

/** Name of a room type in the UI language (falls back on the default-locale name). */
export function localName(
  x: { name: string; nameI18n?: Record<string, string> | null },
  lang: string,
): string {
  return x.nameI18n?.[lang.slice(0, 2)] || x.name;
}

/** Same objects with `name` in the UI language (room types of a planning / availability). */
export function localizeTypes<T extends { name: string; nameI18n?: Record<string, string> | null }>(
  types: T[],
  lang: string,
): T[] {
  return types.map((x) => ({ ...x, name: localName(x, lang) }));
}

export function useRoomTypes(propertyId: string | null) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return useQuery({
    queryKey: ['ref', 'room-types', propertyId],
    queryFn: async () =>
      (await get<{ items: RoomTypeRef[] }>(`/lodging/room-types${qs({ propertyId, limit: 200 })}`))
        .items,
    select: useCallback((items: RoomTypeRef[]) => localizeTypes(items, lang), [lang]),
    enabled: !!propertyId,
    staleTime: STALE,
  });
}

export function useRatePlans(propertyId: string | null) {
  return useQuery({
    queryKey: ['ref', 'rate-plans', propertyId],
    queryFn: async () =>
      (await get<{ items: RatePlan[] }>(`/pricing/rate-plans${qs({ propertyId, limit: 200 })}`))
        .items,
    enabled: !!propertyId,
    staleTime: STALE,
  });
}

export function useLookup(listKey: string) {
  return useQuery({
    queryKey: ['ref', 'lookup', listKey],
    queryFn: async () => (await get<{ items: LookupValue[] }>(`/lookups/${listKey}`)).items,
    staleTime: STALE,
  });
}

export function useCustomFieldDefs(entity: string) {
  return useQuery({
    queryKey: ['ref', 'custom-fields', entity],
    queryFn: async () =>
      (await get<{ items: CustomFieldDef[] }>(`/custom-fields/definitions${qs({ entity })}`)).items,
    staleTime: STALE,
  });
}

export function useBusinessDate(propertyId: string | null) {
  return useQuery({
    queryKey: ['ref', 'business-date', propertyId],
    queryFn: async () =>
      (await get<{ businessDate: string }>(`/lodging/properties/${propertyId}`)).businessDate,
    enabled: !!propertyId,
    staleTime: 60_000,
  });
}

/** Label of a lookup value / select option in the UI language (FR fallback). */
export function useLabel() {
  const { i18n } = useTranslation();
  return (l: { fr: string; en?: string | undefined }) =>
    i18n.language === 'en' && l.en ? l.en : l.fr;
}
