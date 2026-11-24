import type { Prisma, TransactionClient } from '@hm/database';
import { publishEvent } from '../../core/events.js';

export const FOLIO_EVENTS = {
  /** Live folio refresh, emitted to the property room `t:{tid}:p:{pid}`. */
  changed: 'folio.changed',
  paymentRecorded: 'folio.payment_recorded',
  invoiceIssued: 'invoice.issued',
  creditNoteIssued: 'invoice.credit_note_issued',
  cashSessionClosed: 'cash.session_closed',
} as const;

type Tx = Pick<TransactionClient, 'outboxEvent'>;

export function publishFolioChanged(
  tx: Tx,
  folio: { id: string; propertyId: string },
  action: string,
  extra: Record<string, unknown> = {},
) {
  return publishEvent(tx, FOLIO_EVENTS.changed, {
    propertyId: folio.propertyId,
    folioId: folio.id,
    action,
    ...extra,
  } as Prisma.InputJsonValue);
}

export function publishFinance(tx: Tx, type: string, payload: Record<string, unknown>) {
  return publishEvent(tx, type, payload as Prisma.InputJsonValue);
}
