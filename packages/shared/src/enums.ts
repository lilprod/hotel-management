/**
 * Status enums (doc 04). Values explicitly listed in doc 04 are exact; values marked
 * "(assumed)" are not enumerated in doc 04 and must be confirmed with the owning module.
 */
import { z } from 'zod';

type Labels = { fr: string; en: string };

function defineEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return { values, schema: z.enum(values) } as const;
}

export const PLATFORM_USER_ROLES = ['SUPER_ADMIN', 'FINANCE', 'SUPPORT', 'READ_ONLY'] as const;
export type PlatformUserRole = (typeof PLATFORM_USER_ROLES)[number];

export const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** (assumed) */
export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** (assumed) */
export const PLATFORM_INVOICE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
] as const;
export type PlatformInvoiceStatus = (typeof PLATFORM_INVOICE_STATUSES)[number];

/** Platform payment status (doc 04 `payments`). */
export const PAYMENT_STATUSES = ['PENDING_VALIDATION', 'CONFIRMED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Payment declarations (platform and portal deposit declarations). */
export const PAYMENT_DECLARATION_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type PaymentDeclarationStatus = (typeof PAYMENT_DECLARATION_STATUSES)[number];

export const RESERVATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_CHANNELS = ['FRONT_DESK', 'PORTAL', 'PHONE', 'AGENCY'] as const;
export type ReservationChannel = (typeof RESERVATION_CHANNELS)[number];

/** (assumed) per-room status inside a reservation. */
export const RESERVATION_ROOM_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type ReservationRoomStatus = (typeof RESERVATION_ROOM_STATUSES)[number];

export const WAITLIST_STATUSES = [
  'WAITING',
  'OFFERED',
  'ACCEPTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const FOLIO_STATUSES = ['OPEN', 'CLOSED'] as const;
export type FolioStatus = (typeof FOLIO_STATUSES)[number];

export const FOLIO_LINE_TYPES = [
  'ROOM',
  'EXTRA',
  'POS',
  'TAX',
  'DISCOUNT',
  'ADJUSTMENT',
  'SPA',
  'ACTIVITY',
  'PACKAGE',
  'MINIBAR',
  'PENALTY',
] as const;
export type FolioLineType = (typeof FOLIO_LINE_TYPES)[number];

/** (assumed) tenant invoice status; credit notes are separate documents (`credit_note_of_id`). */
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** (assumed) `rooms.hk_status`. */
export const HOUSEKEEPING_STATUSES = [
  'DIRTY',
  'CLEANING',
  'CLEAN',
  'INSPECTED',
  'OUT_OF_SERVICE',
] as const;
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];

/** (assumed) `hk_tasks.status`. */
export const HK_TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'INSPECTED'] as const;
export type HkTaskStatus = (typeof HK_TASK_STATUSES)[number];

export const ROOM_BLOCK_REASONS = ['MAINTENANCE', 'OUT_OF_SERVICE'] as const;
export type RoomBlockReason = (typeof ROOM_BLOCK_REASONS)[number];

export const MAINTENANCE_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

/** (assumed) */
export const MAINTENANCE_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_SOURCES = ['STAFF', 'GUEST', 'AUTO', 'PREVENTIVE'] as const;
export type MaintenanceSource = (typeof MAINTENANCE_SOURCES)[number];

export const ORDER_STATUSES = [
  'OPEN',
  'SENT',
  'SERVED',
  'PAID',
  'CHARGED_TO_ROOM',
  'VOID',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TYPES = ['DINE_IN', 'ROOM', 'TAKEAWAY'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** (assumed) spa appointments. */
export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIAL',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const STOCK_MOVEMENT_TYPES = [
  'IN',
  'OUT',
  'TRANSFER',
  'LOSS',
  'CONSUMPTION',
  'ADJUST',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const LOYALTY_TRANSACTION_TYPES = [
  'EARN',
  'REDEEM',
  'EXPIRE',
  'ADJUST',
  'REVERSAL',
] as const;
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];

export const MFA_MODES = ['OFF', 'OPTIONAL', 'REQUIRED_FOR_ROLES', 'REQUIRED_ALL'] as const;
export type MfaMode = (typeof MFA_MODES)[number];

export const TAX_TYPES = ['PERCENT', 'FIXED_PER_PERSON_NIGHT', 'FIXED_PER_NIGHT'] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const MEAL_PLANS = ['RO', 'BB', 'HB', 'FB'] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];

// ---------------------------------------------------------------------------
// Payment methods (doc 09 §2)
// ---------------------------------------------------------------------------

export const PLATFORM_PAYMENT_METHODS = ['MIXX', 'MOOV_MONEY', 'CASH', 'CARD'] as const;
export type PlatformPaymentMethod = (typeof PLATFORM_PAYMENT_METHODS)[number];

export const TENANT_PAYMENT_METHODS = [
  ...PLATFORM_PAYMENT_METHODS,
  'BANK_TRANSFER',
  'LOYALTY_POINTS',
  'CITY_LEDGER',
] as const;
export type TenantPaymentMethod = (typeof TENANT_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<TenantPaymentMethod, Labels> = {
  MIXX: { fr: 'Mixx by Yas', en: 'Mixx by Yas' },
  MOOV_MONEY: { fr: 'Moov Money', en: 'Moov Money' },
  CASH: { fr: 'Espèces', en: 'Cash' },
  CARD: { fr: 'Carte bancaire (TPE)', en: 'Bank card (POS terminal)' },
  BANK_TRANSFER: { fr: 'Virement bancaire', en: 'Bank transfer' },
  LOYALTY_POINTS: { fr: 'Points de fidélité', en: 'Loyalty points' },
  CITY_LEDGER: { fr: 'Compte débiteur', en: 'City ledger' },
};

export const platformPaymentMethodSchema = z.enum(PLATFORM_PAYMENT_METHODS);
export const tenantPaymentMethodSchema = z.enum(TENANT_PAYMENT_METHODS);

export function paymentMethodLabel(
  method: TenantPaymentMethod,
  locale: 'fr' | 'en' = 'fr',
): string {
  return PAYMENT_METHOD_LABELS[method][locale];
}

// ---------------------------------------------------------------------------
// Zod schemas for the main status enums
// ---------------------------------------------------------------------------

export const subscriptionStatusSchema = defineEnum(SUBSCRIPTION_STATUSES).schema;
export const platformInvoiceStatusSchema = defineEnum(PLATFORM_INVOICE_STATUSES).schema;
export const paymentStatusSchema = defineEnum(PAYMENT_STATUSES).schema;
export const paymentDeclarationStatusSchema = defineEnum(PAYMENT_DECLARATION_STATUSES).schema;
export const reservationStatusSchema = defineEnum(RESERVATION_STATUSES).schema;
export const reservationRoomStatusSchema = defineEnum(RESERVATION_ROOM_STATUSES).schema;
export const folioStatusSchema = defineEnum(FOLIO_STATUSES).schema;
export const housekeepingStatusSchema = defineEnum(HOUSEKEEPING_STATUSES).schema;
export const maintenancePrioritySchema = defineEnum(MAINTENANCE_PRIORITIES).schema;
export const maintenanceStatusSchema = defineEnum(MAINTENANCE_STATUSES).schema;
export const orderStatusSchema = defineEnum(ORDER_STATUSES).schema;
export const appointmentStatusSchema = defineEnum(APPOINTMENT_STATUSES).schema;
export const purchaseOrderStatusSchema = defineEnum(PURCHASE_ORDER_STATUSES).schema;
export const waitlistStatusSchema = defineEnum(WAITLIST_STATUSES).schema;
