import {
  DEFAULT_PLANS,
  DEFAULT_PLAN_CODES,
  QUOTA_KEYS,
  type DefaultPlanCode,
  type PlanDefinition,
} from '@hm/shared';
import type { AdminClient } from '../src/index.js';
import {
  applyDiscountBp,
  ensurePasswordHash,
  seedId,
  SEED_BASE_DOMAIN,
  type Logger,
} from './common.js';

/** Display labels for the default plans (the business matrix itself lives in @hm/shared). */
const PLAN_LABELS: Record<DefaultPlanCode, { name: string; description: string; sort: number }> = {
  STANDARD: { name: 'Standard', description: 'Hébergement, facturation et CRM', sort: 1 },
  MEDIUM: {
    name: 'Medium',
    description: 'Hôtellerie complète avec restauration, spa et RH',
    sort: 2,
  },
  PREMIUM: {
    name: 'Premium',
    description: 'Toutes les fonctionnalités de base, quotas illimités',
    sort: 3,
  },
};

/** Billing cycle → number of months, and the discount key applied to the monthly price. */
const CYCLES = [
  { cycle: 'MONTHLY', months: 1n, discount: null },
  { cycle: 'QUARTERLY', months: 3n, discount: 'quarterlyDiscountBp' },
  { cycle: 'YEARLY', months: 12n, discount: 'yearlyDiscountBp' },
] as const;

/** Effective date of the seeded price list (prices are versioned by valid_from). */
const PRICE_VALID_FROM = new Date('2026-01-01T00:00:00Z');

/** Price in XOF for a plan and billing cycle, computed from the shared plan definition. */
export function planPriceXof(
  def: PlanDefinition,
  cycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
): bigint {
  const entry = CYCLES.find((c) => c.cycle === cycle);
  if (!entry) throw new Error(`Unknown billing cycle ${cycle}`);
  const gross = BigInt(def.monthlyPriceXof) * entry.months;
  if (entry.discount === null) return gross;
  return applyDiscountBp(gross, def[entry.discount]);
}

/** Platform settings seeded with placeholders: real values are set by the Super Admin. */
const PLATFORM_SETTINGS: Record<string, unknown> = {
  'billing.identity': {
    legalName: '[À COMPLÉTER] Raison sociale de la plateforme',
    country: 'TG',
    currency: 'XOF',
    taxId: '[À COMPLÉTER] NIF',
    rccm: '[À COMPLÉTER] RCCM',
    address: '[À COMPLÉTER] Adresse',
    email: 'billing@platform.example.invalid',
  },
  'billing.payment_instructions': {
    note: 'Effectuez le paiement sur le numéro marchand indiqué, puis saisissez la référence de transaction.',
    methods: [
      {
        code: 'MIXX',
        label: 'Mixx by Yas',
        merchantNumber: 'PLACEHOLDER-MIXX-MERCHANT',
        referenceLabel: 'ID de transaction Mixx',
        referencePattern: '^[A-Za-z0-9]{6,30}$', // [À CONFIRMER] format réel de l'opérateur
      },
      {
        code: 'MOOV_MONEY',
        label: 'Moov Money',
        merchantNumber: 'PLACEHOLDER-MOOV-MERCHANT',
        referenceLabel: 'ID de transaction Moov Money',
        referencePattern: '^[A-Za-z0-9]{6,30}$', // [À CONFIRMER] format réel de l'opérateur
      },
    ],
  },
  'billing.grace_days': 7,
  'billing.purge_days': 90,
  // Relances (doc 02 §5). Offsets are in days relative to the event (negative = before).
  'billing.reminders': [
    { model: 'trial_ending', offsetsDays: [-3, -1], channels: ['EMAIL', 'BANNER'] },
    {
      model: 'invoice_upcoming',
      offsetsDays: [-7, -3],
      channels: ['EMAIL'],
      optionalChannels: ['SMS'],
    },
    {
      model: 'invoice_due',
      offsetsDays: [0],
      channels: ['EMAIL', 'BANNER'],
      optionalChannels: ['SMS'],
    },
    {
      model: 'invoice_overdue',
      offsetsDays: [3, 7],
      channels: ['EMAIL'],
      optionalChannels: ['SMS'],
    },
    {
      model: 'account_suspended',
      offsetsDays: [0],
      channels: ['EMAIL'],
      optionalChannels: ['SMS'],
    },
  ],
};

export interface PlatformSeedOptions {
  superAdminEmail?: string;
  superAdminPassword?: string;
  log: Logger;
}

export interface PlatformSeedResult {
  plans: number;
  planPrices: number;
  planFeatures: number;
  planQuotas: number;
  settings: number;
  superAdmin: boolean;
}

export async function seedPlatform(
  admin: AdminClient,
  options: PlatformSeedOptions,
): Promise<PlatformSeedResult> {
  const result: PlatformSeedResult = {
    plans: 0,
    planPrices: 0,
    planFeatures: 0,
    planQuotas: 0,
    settings: 0,
    superAdmin: false,
  };

  for (const code of DEFAULT_PLAN_CODES) {
    const def = DEFAULT_PLANS[code];
    const label = PLAN_LABELS[code];
    const planId = seedId(`plan:${code}`);

    await admin.plan.upsert({
      where: { code },
      create: {
        id: planId,
        code,
        name: label.name,
        description: label.description,
        trialDays: def.trialDays,
        sort: label.sort,
        isPublic: true,
        isActive: true,
      },
      update: {
        name: label.name,
        description: label.description,
        trialDays: def.trialDays,
        sort: label.sort,
      },
    });
    result.plans += 1;

    for (const { cycle } of CYCLES) {
      const amount = planPriceXof(def, cycle);
      await admin.planPrice.upsert({
        where: { id: seedId(`plan-price:${code}:${cycle}:XOF`) },
        create: {
          id: seedId(`plan-price:${code}:${cycle}:XOF`),
          planId,
          billingCycle: cycle,
          currency: 'XOF',
          amount,
          validFrom: PRICE_VALID_FROM,
        },
        update: { amount, validFrom: PRICE_VALID_FROM },
      });
      result.planPrices += 1;
    }

    for (const featureKey of def.features) {
      await admin.planFeature.upsert({
        where: { planId_featureKey: { planId, featureKey } },
        create: {
          id: seedId(`plan-feature:${code}:${featureKey}`),
          planId,
          featureKey,
          enabled: true,
        },
        update: { enabled: true },
      });
      result.planFeatures += 1;
    }

    for (const quotaKey of QUOTA_KEYS) {
      const limit = def.quotas[quotaKey];
      await admin.planQuota.upsert({
        where: { planId_quotaKey: { planId, quotaKey } },
        create: { id: seedId(`plan-quota:${code}:${quotaKey}`), planId, quotaKey, limit },
        update: { limit },
      });
      result.planQuotas += 1;
    }
  }
  options.log(
    `platform: ${result.plans} plans, ${result.planPrices} prices, ${result.planFeatures} features, ${result.planQuotas} quotas`,
  );

  for (const [key, value] of Object.entries(PLATFORM_SETTINGS)) {
    const json = value as object;
    await admin.platformSetting.upsert({
      where: { key },
      create: { id: seedId(`platform-setting:${key}`), key, value: json },
      update: { value: json },
    });
    result.settings += 1;
  }
  options.log(`platform: ${result.settings} settings (placeholders to complete)`);

  const email = options.superAdminEmail?.trim().toLowerCase();
  const password = options.superAdminPassword;
  if (email && password) {
    const existing = await admin.platformUser.findUnique({ where: { email } });
    const passwordHash = await ensurePasswordHash(existing?.passwordHash, password);
    await admin.platformUser.upsert({
      where: { email },
      create: {
        id: seedId(`platform-user:${email}`),
        email,
        name: 'Super administrateur',
        role: 'SUPER_ADMIN',
        passwordHash,
      },
      update: { passwordHash, role: 'SUPER_ADMIN', isActive: true },
    });
    result.superAdmin = true;
    options.log(`platform: super admin ${email} ready`);
  } else {
    options.log(
      `platform: WARNING SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD not set, super admin skipped (base ${SEED_BASE_DOMAIN})`,
    );
  }

  return result;
}
