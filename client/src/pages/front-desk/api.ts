import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../auth/session';
import { get, post, qs } from '../../reservations/api';

/** Front desk API (`/api/v1/t/front-desk`, L7a): types mirror the server Zod schemas. */

export type DayListKind = 'arrivals' | 'departures' | 'in-house' | 'no-shows';
export const DAY_LISTS: readonly DayListKind[] = ['arrivals', 'departures', 'in-house', 'no-shows'];

export interface DayRow {
  reservationId: string;
  reservationRoomId: string;
  stayId: string | null;
  number: string;
  status: string;
  guest: { id: string | null; name: string; phone: string | null; email: string | null };
  companyName: string | null;
  roomTypeId: string;
  roomTypeName: string;
  roomId: string | null;
  roomNumber: string | null;
  hkStatus: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  late: boolean;
  balance: number | null;
  currency: string;
}

export interface DayList {
  businessDate: string;
  date: string;
  items: DayRow[];
}

export interface Summary {
  businessDate: string;
  date: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  noShows: number;
  availableCleanRooms: number;
}

export interface AvailableRoom {
  id: string;
  number: string;
  roomTypeId: string;
  roomTypeName: string;
  floor: string | null;
  hkStatus: string;
  clean: boolean;
}

export interface Identity {
  guestId?: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  birthPlace: string;
  nationality: string;
  profession: string;
  address: string;
  idDocType: string;
  idDocNumber: string;
  idIssuedOn: string;
  idIssuedPlace: string;
}

export interface StayResult {
  stayId: string;
  reservationRoomId: string;
  reservationId: string;
  roomId: string;
  roomNumber: string;
  policeRecordIds: string[];
  deposit: { ok: boolean; paymentId: string | null; error: string | null } | null;
  notified: boolean;
  warnings: string[];
}

export interface CheckoutBlocker {
  code: 'NOT_IN_HOUSE' | 'UNPAID_BALANCE' | 'CREDIT_BALANCE' | 'OPEN_POS_ORDERS';
  message: string;
  folioId?: string;
  amount?: number;
  count?: number;
}

export interface CheckoutPreview {
  stayId: string;
  reservationRoomId: string;
  reservationId: string;
  reservationNumber: string;
  roomNumber: string | null;
  businessDate: string;
  arrival: string;
  departure: string;
  currency: string;
  earlyDeparture: boolean;
  folios: {
    id: string;
    number: string;
    status: string;
    balance: number;
    currency: string;
    chargesTotal: number;
    paymentsTotal: number;
  }[];
  summary: { department: string; amount: number }[];
  chargesTotal: number;
  paymentsTotal: number;
  balance: number;
  blockers: CheckoutBlocker[];
  canCheckout: boolean;
}

export interface CheckoutResult {
  stayId: string;
  reservationStatus: string;
  balance: number;
  transferred: number;
  overridden: string[];
  invoices: { id: string; number: string; total: number }[];
  notified: boolean;
  warnings: string[];
}

export interface CompanyOption {
  id: string;
  name: string;
  taxId: string | null;
  creditLimit: number | null;
}

export interface PoliceRecord {
  id: string;
  stayId: string;
  guestId: string;
  checkedInAt: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  profession: string | null;
  address: string | null;
  idDocType: string | null;
  idDocNumber: string | null;
  idIssuedOn: string | null;
  idIssuedPlace: string | null;
  provenance: string | null;
  destination: string | null;
  purpose: string | null;
  arrival: string;
  departure: string;
  roomNumber: string | null;
  reservationNumber: string | null;
  hasSignature: boolean;
  masked: boolean;
}

export interface PolicePage {
  items: PoliceRecord[];
  nextCursor: string | null;
  masked: boolean;
}

export const fdKeys = {
  all: ['front-desk'] as const,
  list: (kind: DayListKind, propertyId: string | null, search: string) =>
    ['front-desk', 'list', kind, propertyId, search] as const,
  summary: (propertyId: string | null) => ['front-desk', 'summary', propertyId] as const,
  rooms: (propertyId: string | null, from: string, to: string, type: string, rr: string) =>
    ['front-desk', 'rooms', propertyId, from, to, type, rr] as const,
  checkout: (id: string) => ['front-desk', 'checkout', id] as const,
  police: (propertyId: string | null, from: string, to: string, search: string) =>
    ['front-desk', 'police', propertyId, from, to, search] as const,
};

export function useDayList(kind: DayListKind, propertyId: string | null, search: string) {
  return useQuery({
    queryKey: fdKeys.list(kind, propertyId, search),
    queryFn: () => get<DayList>(`/front-desk/${kind}${qs({ propertyId, search })}`),
    enabled: !!propertyId,
  });
}

export function useSummary(propertyId: string | null) {
  return useQuery({
    queryKey: fdKeys.summary(propertyId),
    queryFn: () => get<Summary>(`/front-desk/summary${qs({ propertyId })}`),
    enabled: !!propertyId,
  });
}

export function useAvailableRooms(p: {
  propertyId: string | null;
  from: string;
  to: string;
  roomTypeId?: string | undefined;
  reservationRoomId?: string | undefined;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: fdKeys.rooms(
      p.propertyId,
      p.from,
      p.to,
      p.roomTypeId ?? '',
      p.reservationRoomId ?? '',
    ),
    queryFn: () =>
      get<AvailableRoom[]>(
        `/front-desk/available-rooms${qs({
          propertyId: p.propertyId,
          from: p.from,
          to: p.to,
          roomTypeId: p.roomTypeId,
          reservationRoomId: p.reservationRoomId,
        })}`,
      ),
    enabled: !!p.propertyId && !!p.from && !!p.to && p.enabled !== false,
  });
}

export const useCompanies = (search: string, enabled: boolean) =>
  useQuery({
    queryKey: ['front-desk', 'companies', search],
    queryFn: () => get<CompanyOption[]>(`/front-desk/companies${qs({ search })}`),
    enabled,
    staleTime: 30_000,
  });

/** Uploads a signature image / ID scan and returns the file id. */
export async function uploadFdFile(kind: 'signature' | 'id_scan', file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await apiClient.post<{ fileId: string }>(`/front-desk/files?kind=${kind}`, body);
  return res.fileId;
}

/** Printable police form: opens the signed PDF URL. */
export async function openPoliceForm(stayRef: string): Promise<void> {
  const { url } = await get<{ url: string }>(`/front-desk/stays/${stayRef}/police-form`);
  window.open(url, '_blank', 'noopener');
}

export { get, post, qs };
