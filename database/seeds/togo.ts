import type { AdminClient } from '../src/index.js';
import { seedId, SEED_COUNTRY, type Logger } from './common.js';

/** Stable ids of the global Togo tax rules, reused by the demo tenants (Tax.taxRuleId). */
export const TOGO_TAX_RULE_IDS = {
  VAT_STANDARD: seedId('tax-rule:TG:TVA_NORMAL:2026-01-01'),
  TOURIST_TAX_EXAMPLE: seedId('tax-rule:TG:TAXE_SEJOUR_EXEMPLE:2026-01-01'),
} as const;

/**
 * Togo parameters (doc 09). Nothing here is hard-coded in the application: these rows are
 * read through tax_rules and the adapters. Values marked [À CONFIRMER] must be validated by an
 * accountant or lawyer before go-live.
 */
const EFFECTIVE_FROM = new Date('2026-01-01T00:00:00Z');

export async function seedTogo(admin: AdminClient, log: Logger): Promise<{ taxRules: number }> {
  // Normal VAT rate, 18 %. Reduced rates or exemptions are [À CONFIRMER] (doc 09 §3).
  await admin.taxRule.upsert({
    where: {
      country_code_effectiveFrom: {
        country: SEED_COUNTRY,
        code: 'TVA_NORMAL',
        effectiveFrom: EFFECTIVE_FROM,
      },
    },
    create: {
      id: TOGO_TAX_RULE_IDS.VAT_STANDARD,
      country: SEED_COUNTRY,
      code: 'TVA_NORMAL',
      name: 'TVA taux normal 18 %',
      kind: 'PERCENT',
      base: 'HT',
      rate: '18',
      inclusive: false,
      effectiveFrom: EFFECTIVE_FROM,
    },
    update: { name: 'TVA taux normal 18 %', kind: 'PERCENT', base: 'HT', rate: '18' },
  });

  // Example tourist tax: fixed amount per person per night. Amount, base, exemptions and the
  // beneficiary collectivity are [À CONFIRMER] (doc 09 §3). Example value only.
  const touristTaxName = 'Taxe de séjour (exemple) [À CONFIRMER]';
  await admin.taxRule.upsert({
    where: {
      country_code_effectiveFrom: {
        country: SEED_COUNTRY,
        code: 'TAXE_SEJOUR_EXEMPLE',
        effectiveFrom: EFFECTIVE_FROM,
      },
    },
    create: {
      id: TOGO_TAX_RULE_IDS.TOURIST_TAX_EXAMPLE,
      country: SEED_COUNTRY,
      code: 'TAXE_SEJOUR_EXEMPLE',
      name: touristTaxName,
      kind: 'FIXED_PER_PERSON_NIGHT',
      base: 'ROOM_NIGHT',
      rate: '1000', // XOF per person per night, example only [À CONFIRMER]
      inclusive: false,
      exemptions: { note: '[À CONFIRMER] exonérations (enfants, résidents) à définir' },
      effectiveFrom: EFFECTIVE_FROM,
    },
    update: {
      name: touristTaxName,
      kind: 'FIXED_PER_PERSON_NIGHT',
      base: 'ROOM_NIGHT',
      rate: '1000',
      exemptions: { note: '[À CONFIRMER] exonérations (enfants, résidents) à définir' },
    },
  });

  log('togo: 2 tax rules (TVA 18 %, taxe de séjour exemple [À CONFIRMER])');
  return { taxRules: 2 };
}
