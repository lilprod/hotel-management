import type { AdminClient, Prisma } from '@hm/database';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

/**
 * Platform billing settings (`platform_settings`, SA-39 / EX-03): one JSON value per key,
 * validated by Zod; a missing or invalid stored value falls back to the default.
 */
const methodCode = z.enum(['MIXX', 'MOOV_MONEY', 'CASH', 'CARD']);

export const billingIdentitySchema = z.object({
  legalName: z.string().min(1).max(200),
  legalForm: z.string().max(100).optional(),
  country: z.string().length(2),
  currency: z.string().length(3).default('XOF'),
  taxId: z.string().max(100).optional(),
  rccm: z.string().max(100).optional(),
  taxRegime: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
});

export const paymentInstructionsSchema = z.object({
  note: z.string().max(2000).default(''),
  methods: z
    .array(
      z.object({
        code: methodCode,
        label: z.string().min(1).max(100),
        merchantNumber: z.string().max(100).optional(),
        referenceLabel: z.string().max(100).optional(),
        /** Regex validating the payment reference of this method (doc 09 §2), never hard-coded. */
        referencePattern: z
          .string()
          .max(300)
          .refine((p) => {
            try {
              new RegExp(p);
              return true;
            } catch {
              return false;
            }
          }, 'Invalid regular expression')
          .optional(),
      }),
    )
    .max(10),
});

export const reminderRuleSchema = z.object({
  model: z.enum([
    'trial_ending',
    'invoice_upcoming',
    'invoice_due',
    'invoice_overdue',
    'account_suspended',
  ]),
  /** Days relative to the event (trial end / due date); negative = before. */
  offsetsDays: z.array(z.number().int().min(-60).max(60)).max(10),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'BANNER'])).max(3),
  optionalChannels: z
    .array(z.enum(['EMAIL', 'SMS', 'BANNER']))
    .max(3)
    .optional(),
});

export const vatSchema = z.object({
  enabled: z.boolean(),
  /** Basis points (1800 = 18 %). */
  rateBps: z.number().int().min(0).max(10_000),
  label: z.string().min(1).max(30).default('TVA'),
});

export const PLATFORM_BILLING_SETTINGS = {
  identity: {
    key: 'billing.identity',
    schema: billingIdentitySchema,
    default: { legalName: 'Plateforme', country: 'TG', currency: 'XOF' },
  },
  paymentInstructions: {
    key: 'billing.payment_instructions',
    schema: paymentInstructionsSchema,
    default: { note: '', methods: [] },
  },
  graceDays: { key: 'billing.grace_days', schema: z.number().int().min(0).max(60), default: 7 },
  /** R: days in SUSPENDED before automatic cancellation (doc 02 §2). */
  suspensionDays: {
    key: 'billing.suspension_days',
    schema: z.number().int().min(1).max(730),
    default: 90,
  },
  /** Retention after cancellation before the purge (EX-11). */
  purgeDays: { key: 'billing.purge_days', schema: z.number().int().min(1).max(3650), default: 90 },
  reminders: {
    key: 'billing.reminders',
    schema: z.array(reminderRuleSchema).max(10),
    default: [
      { model: 'trial_ending', offsetsDays: [-3, -1], channels: ['EMAIL', 'BANNER'] },
      { model: 'invoice_upcoming', offsetsDays: [-7, -3], channels: ['EMAIL'] },
      { model: 'invoice_due', offsetsDays: [0], channels: ['EMAIL', 'BANNER'] },
      { model: 'invoice_overdue', offsetsDays: [3, 7], channels: ['EMAIL'] },
      { model: 'account_suspended', offsetsDays: [0], channels: ['EMAIL'] },
    ],
  },
  /** SA-35: a payment recorded by one user is confirmed by another. */
  doubleValidation: { key: 'billing.double_validation', schema: z.boolean(), default: false },
  /** SMS in addition to e-mail for the reminders marked `optionalChannels: ['SMS']`. */
  smsReminders: { key: 'billing.sms_reminders', schema: z.boolean(), default: false },
  vat: {
    key: 'billing.vat',
    schema: vatSchema,
    default: { enabled: false, rateBps: 1800, label: 'TVA' },
  },
  /** Due date of ad-hoc invoices (subscription, prorata) = issue date + N days. */
  paymentTermsDays: {
    key: 'billing.payment_terms_days',
    schema: z.number().int().min(0).max(90),
    default: 7,
  },
  /** Renewal invoices are issued N days before the period end (doc 02 §3: J-7). */
  renewalLeadDays: {
    key: 'billing.renewal_lead_days',
    schema: z.number().int().min(0).max(60),
    default: 7,
  },
} as const;

type Defs = typeof PLATFORM_BILLING_SETTINGS;
export type BillingSettingName = keyof Defs;
export type BillingSettings = { [K in BillingSettingName]: z.output<Defs[K]['schema']> };

export const BILLING_SETTING_NAMES = Object.keys(PLATFORM_BILLING_SETTINGS) as BillingSettingName[];

/** Partial update body of `PATCH /admin/billing/settings`. */
export const billingSettingsPatch = z
  .object(
    Object.fromEntries(
      BILLING_SETTING_NAMES.map((n) => [n, PLATFORM_BILLING_SETTINGS[n].schema.optional()]),
    ) as { [K in BillingSettingName]: z.ZodOptional<Defs[K]['schema']> },
  )
  .strict();

function parse<K extends BillingSettingName>(name: K, raw: unknown): BillingSettings[K] {
  const def = PLATFORM_BILLING_SETTINGS[name];
  const r = def.schema.safeParse(raw);
  return (r.success ? r.data : def.schema.parse(def.default)) as BillingSettings[K];
}

/** Reads every billing setting (one query). */
export async function loadBillingSettings(admin: AdminClient): Promise<BillingSettings> {
  const rows = await admin.platformSetting.findMany({
    where: { key: { in: BILLING_SETTING_NAMES.map((n) => PLATFORM_BILLING_SETTINGS[n].key) } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<string, unknown>;
  for (const n of BILLING_SETTING_NAMES)
    out[n] = parse(n, byKey.get(PLATFORM_BILLING_SETTINGS[n].key));
  return out as BillingSettings;
}

export async function getBillingSetting<K extends BillingSettingName>(
  admin: Pick<AdminClient, 'platformSetting'>,
  name: K,
): Promise<BillingSettings[K]> {
  const row = await admin.platformSetting.findUnique({
    where: { key: PLATFORM_BILLING_SETTINGS[name].key },
  });
  return parse(name, row?.value);
}

/** Validated upsert of several settings; returns the before/after values for the audit. */
export async function updateBillingSettings(
  admin: AdminClient,
  patch: Partial<BillingSettings>,
): Promise<{ before: Partial<BillingSettings>; after: Partial<BillingSettings> }> {
  const current = await loadBillingSettings(admin);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  await admin.$transaction(async (tx) => {
    for (const [name, value] of Object.entries(patch) as [BillingSettingName, unknown][]) {
      if (value === undefined) continue;
      const def = PLATFORM_BILLING_SETTINGS[name];
      const parsed = def.schema.safeParse(value);
      if (!parsed.success)
        throw new AppError('VALIDATION_ERROR', undefined, { detail: `Invalid setting ${name}` });
      const json = parsed.data as Prisma.InputJsonValue;
      await tx.platformSetting.upsert({
        where: { key: def.key },
        create: { key: def.key, value: json },
        update: { value: json },
      });
      before[name] = current[name];
      after[name] = parsed.data;
    }
  });
  return { before, after };
}
