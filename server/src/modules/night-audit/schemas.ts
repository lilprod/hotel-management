import { z } from 'zod';
import { dayString, idParams, uuid } from '../property/common.js';

export { idParams };

export const propertyQuery = z.object({ propertyId: uuid });

export const decisionSchema = z.object({
  reservationId: uuid,
  action: z.enum(['NO_SHOW', 'KEEP']),
  waivePenalty: z.boolean().optional(),
});

export const runBody = z.object({
  propertyId: uuid,
  /** Business date being closed (idempotency key): must be the current business date. */
  businessDate: dayString,
  decisions: z.array(decisionSchema).max(500).optional(),
});

export const listQuery = z.object({
  propertyId: uuid,
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: uuid.optional(),
});

// ── responses ──
const money = z.object({ amount: z.number(), currency: z.string() });

export const checkItemSchema = z.object({
  reservationId: uuid.optional(),
  reservationRoomId: uuid.optional(),
  stayId: uuid.nullable().optional(),
  number: z.string().optional(),
  guestName: z.string().optional(),
  roomNumber: z.string().nullable().optional(),
  arrival: z.string().optional(),
  departure: z.string().optional(),
  balance: z.number().optional(),
  currency: z.string().optional(),
  penalty: money.nullable().optional(),
  canNoShow: z.boolean().optional(),
  folioId: uuid.optional(),
  cashSessionId: uuid.optional(),
  userId: uuid.optional(),
  userName: z.string().optional(),
  openedAt: z.string().optional(),
});

export const precheckSchema = z.object({
  propertyId: uuid,
  businessDate: z.string(),
  closedDate: z.string().nullable(),
  running: z.object({ id: uuid, status: z.string(), startedAt: z.string() }).nullable(),
  checks: z.array(
    z.object({
      code: z.enum([
        'PENDING_ARRIVALS',
        'PENDING_DEPARTURES',
        'OPEN_CASH_SESSIONS',
        'NEGATIVE_BALANCES',
        'UNASSIGNED_IN_HOUSE',
      ]),
      severity: z.enum(['DECISION', 'WARNING', 'BLOCKING']),
      count: z.number().int(),
      items: z.array(checkItemSchema),
    }),
  ),
  canRun: z.boolean(),
});

export const kpisSchema = z.object({
  businessDate: z.string(),
  currency: z.string(),
  roomsAvailable: z.number().int(),
  roomsSold: z.number().int(),
  occupancy: z.string(),
  occupancyBp: z.number().int(),
  roomRevenue: z.number(),
  totalRevenue: z.number(),
  adr: z.number(),
  revpar: z.number(),
  revenueByDept: z.record(z.string(), z.number()),
  taxes: z.array(z.object({ code: z.string(), name: z.string(), kind: z.enum(['VAT', 'TOURIST']), amount: z.number() })),
  vatTotal: z.number(),
  touristTaxTotal: z.number(),
  payments: z.array(z.object({ method: z.string(), amount: z.number() })),
  paymentsTotal: z.number(),
  arrivals: z.number().int(),
  departures: z.number().int(),
  inHouse: z.number().int(),
  noShows: z.number().int(),
  window: z.object({ from: z.string(), to: z.string() }),
});

export const auditSchema = z.object({
  id: uuid,
  propertyId: uuid,
  businessDate: z.string(),
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']),
  trigger: z.enum(['manual', 'auto']),
  startedBy: uuid.nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  steps: z.array(
    z.object({
      step: z.string(),
      status: z.enum(['pending', 'done', 'failed']),
      at: z.string().nullable(),
      error: z.string().nullable(),
      result: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  decisions: z.array(decisionSchema),
  warnings: z.array(z.object({ code: z.string(), count: z.number().int() })),
  kpis: kpisSchema.nullable(),
  reportFileId: uuid.nullable(),
  error: z.string().nullable(),
});

export const runResult = z.object({ audit: auditSchema, alreadyCompleted: z.boolean() });
export const auditPage = z.object({ items: z.array(auditSchema), nextCursor: uuid.nullable() });
export const reportSchema = z.object({ fileId: uuid, url: z.string() });
