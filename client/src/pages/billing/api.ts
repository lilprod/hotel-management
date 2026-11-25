import { useQuery } from '@tanstack/react-query';

import { get, post, qs } from '../../reservations/api';

/** Billing API (`/api/v1/t`: folios, invoices, cash sessions, city ledger, exchange rates). Types mirror the server Zod schemas (L7b). */

export const PAY_METHODS = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'MIXX',
  'MOOV_MONEY',
  'CITY_LEDGER',
] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const TENDER_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'MIXX', 'MOOV_MONEY'] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

export interface FolioLine {
  id: string;
  folioId: string;
  businessDate: string;
  type: string;
  departmentCode: string | null;
  label: string;
  qty: number;
  currency: string;
  unitAmount: number;
  amount: number;
  taxAmount: number;
  productId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  createdAt: string;
}

export interface FolioPayment {
  id: string;
  folioId: string;
  method: string;
  currency: string;
  amount: number;
  reference: string | null;
  isDeposit: boolean;
  status: string;
  paidAt: string;
  cashSessionId: string | null;
  tenderedCurrency: string | null;
  tenderedAmount: number | null;
  rate: string | null;
  reversedById: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface TaxRow {
  code: string;
  name: string;
  type: string;
  rate: string | null;
  base: number;
  amount: number;
}

export interface FolioHeader {
  id: string;
  propertyId: string;
  number: string;
  status: 'OPEN' | 'CLOSED';
  currency: string;
  balance: number;
  stayId: string | null;
  groupId: string | null;
  companyId: string | null;
  closedAt: string | null;
  createdAt: string;
  kind: 'STAY' | 'GROUP' | 'COMPANY' | 'OTHER';
  reservationId: string | null;
  reservationNumber: string | null;
  reservationRoomId: string | null;
}

export interface Folio extends FolioHeader {
  chargesTotal: number;
  paymentsTotal: number;
  taxBreakdown: {
    net: number;
    percentTax: number;
    fixedTax: number;
    total: number;
    untaxedBase: number;
    rows: TaxRow[];
  };
  lines: FolioLine[];
  payments: FolioPayment[];
}

export interface PaymentResult {
  payment: FolioPayment;
  convertedAmount: number;
  change: number;
  changeCurrency: string;
  companyFolioId: string | null;
  folio: Folio;
}

export interface Invoice {
  id: string;
  propertyId: string;
  folioId: string;
  number: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  creditNoteOfId: string | null;
  issueDate: string;
  customer: {
    type: string;
    id: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    taxId: string | null;
  };
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  status: string;
  pdfFileId: string | null;
  totals: {
    lineIds?: string[];
    lines?: {
      lineId: string;
      description: string;
      quantity: number;
      unitAmount: number;
      net: number;
      taxRate: string;
    }[];
  };
  fiscal: {
    provider: string;
    status: string;
    fiscalNumber: string | null;
    qrCode: string | null;
  } | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CashTotals {
  method: string;
  currency: string;
  count: number;
  received: number;
  paidOut: number;
  net: number;
}
export interface CashSession {
  id: string;
  propertyId: string;
  userId: string;
  status: 'OPEN' | 'CLOSED';
  currency: string;
  openingFloat: number;
  openedAt: string;
  closedAt: string | null;
  expectedAmount: number | null;
  countedAmount: number | null;
  variance: number | null;
  note: string | null;
  expected?: { method: string; currency: string; expected: number }[];
}
export interface CashReport {
  kind: 'X' | 'Z';
  session: CashSession;
  generatedAt: string;
  totals: CashTotals[];
  nonTender: CashTotals[];
  movements: {
    in: { currency: string; amount: number; count: number }[];
    out: { currency: string; amount: number; count: number }[];
  };
  expected: { method: string; currency: string; expected: number }[];
  counted:
    | { method: string; currency: string; expected: number; counted: number; variance: number }[]
    | null;
}

export interface ExchangeRate {
  id: string;
  base: string;
  quote: string;
  rate: string;
  validOn: string;
  updatedAt: string;
}

export interface CompanyAccount {
  folioId: string;
  number: string;
  propertyId: string;
  companyId: string;
  companyName: string;
  taxId: string | null;
  currency: string;
  creditLimit: number | null;
  charges: number;
  settlements: number;
  balance: number;
}
export interface Statement {
  company: { id: string; name: string; taxId: string | null };
  openingBalance: number;
  entries: {
    date: string;
    kind: 'CHARGE' | 'SETTLEMENT';
    label: string;
    reference: string | null;
    folioNumber: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}
export interface Aging {
  asOf: string;
  items: {
    companyId: string;
    companyName: string;
    buckets: { current: number; d31_60: number; d61_90: number; over90: number };
    total: number;
  }[];
  totals: { current: number; d31_60: number; d61_90: number; over90: number; total: number };
}

export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  departmentCode: string | null;
  isActive: boolean;
}

export const bkKeys = {
  all: ['billing'] as const,
  folio: (id: string) => ['billing', 'folio', id] as const,
  folios: (q: object) => ['billing', 'folios', q] as const,
  invoices: (q: object) => ['billing', 'invoices', q] as const,
  cashCurrent: (p: string | null) => ['billing', 'cash', 'current', p] as const,
  cashList: (q: object) => ['billing', 'cash', 'list', q] as const,
  cashReport: (id: string, kind: string) => ['billing', 'cash', 'report', id, kind] as const,
  rates: ['billing', 'rates'] as const,
  accounts: (p: string | null) => ['billing', 'cl', 'accounts', p] as const,
  statement: (c: string, p: string | null) => ['billing', 'cl', 'statement', c, p] as const,
  aging: (p: string | null) => ['billing', 'cl', 'aging', p] as const,
};

export const useFolio = (id: string | null) =>
  useQuery({
    queryKey: bkKeys.folio(id ?? ''),
    queryFn: () => get<Folio>(`/folios/${id}`),
    enabled: !!id,
  });

export const useFolioSiblings = (reservationRoomId: string | null) =>
  useQuery({
    queryKey: bkKeys.folios({ reservationRoomId }),
    queryFn: () => get<Page<FolioHeader>>(`/folios${qs({ reservationRoomId, limit: 50 })}`),
    enabled: !!reservationRoomId,
  });

export function useProducts(propertyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['billing', 'products', propertyId],
    queryFn: () => get<Page<Product>>(`/catalog/products${qs({ propertyId, limit: 100 })}`),
    enabled: enabled && !!propertyId,
  });
}

export interface Department {
  code: string;
  name: string;
  system: boolean;
  isActive: boolean;
}

/** Departments of a property with their names in the UI language (folio lines, charge form). */
export function useDepartments(propertyId: string | null, locale: string, enabled = true) {
  const lang = locale.startsWith('en') ? 'en' : 'fr';
  return useQuery({
    queryKey: ['billing', 'departments', propertyId, lang],
    queryFn: () => get<{ items: Department[] }>(`/departments${qs({ propertyId, locale: lang })}`),
    enabled: enabled && !!propertyId,
    staleTime: 5 * 60_000,
  });
}

/** Opens a signed document URL (invoice PDF, receipt) in a new tab. */
export async function openDocument(path: string, method: 'get' | 'post' = 'get'): Promise<string> {
  const doc =
    method === 'get' ? await get<{ url: string }>(path) : await post<{ url: string }>(path);
  window.open(doc.url, '_blank', 'noopener');
  return doc.url;
}

export { get, post, qs };
