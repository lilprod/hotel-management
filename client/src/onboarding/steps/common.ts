import type { MutableRefObject } from 'react';

/** Saves the step; resolves `true` when the wizard may move on. */
export type StepSave = () => Promise<boolean>;

export interface StepProps {
  propertyId: string;
  /** The step registers its save function here; the wizard calls it on "Next". */
  saveRef: MutableRefObject<StepSave | null>;
}

export interface Items<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface PropertyDto {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  taxId: string | null;
  rccm: string | null;
  currency: string;
  timezone: string;
  checkinTime: string;
  checkoutTime: string;
}

export interface RoomTypeDto {
  id: string;
  code: string;
  name: string;
  maxAdults: number;
  beds: string | null;
}

export interface RoomDto {
  id: string;
  roomTypeId: string;
  number: string;
}

export const propertyKey = (id: string) => ['wizard', 'property', id] as const;
export const roomTypesKey = (id: string) => ['wizard', 'room-types', id] as const;
export const roomsKey = (id: string) => ['wizard', 'rooms', id] as const;
export const quotaKey = ['billing', 'subscription'] as const;

/** Stable room type code from its name: "Chambre Supérieure" → "CHAMBRE-SUPERIEURE". */
export function codeFor(name: string, taken: readonly string[]): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16)
      .replace(/-+$/g, '') || 'TYPE';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const c = `${base}-${i}`;
    if (!taken.includes(c)) return c;
  }
  return `${base}-${Date.now() % 1000}`;
}

/** Relative luminance contrast of white text over `hex` (WCAG 2.x). */
export function contrastWithWhite(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return 21;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (l + 0.05);
}
