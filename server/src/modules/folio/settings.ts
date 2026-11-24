import { z } from 'zod';
import { defineSetting } from '../../core/settings.js';

const tenantOrProperty = ['PLATFORM', 'TENANT', 'PROPERTY'] as const;

const regex = z.string().refine((s) => {
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
}, 'Invalid regular expression');

/** Folio and guest payment settings (hierarchy PROPERTY > TENANT > PLATFORM > default). */
export const folioSettings = {
  referencePatterns: defineSetting({
    key: 'payments.reference_patterns',
    schema: z.record(z.string(), regex),
    default: {} as Record<string, string>,
    scopes: tenantOrProperty,
    description:
      'Regular expression of the payment reference per method (doc 09 §2), e.g. {"MIXX":"^[A-Z0-9]{8,20}$"}',
  }),
  fxRounding: defineSetting({
    key: 'payments.fx_rounding',
    schema: z.enum(['DOWN', 'HALF_UP']),
    default: 'DOWN' as 'DOWN' | 'HALF_UP',
    scopes: tenantOrProperty,
    description: 'Rounding of a foreign-currency tender converted to the folio currency (EX-21)',
  }),
  fxMaxRateAgeDays: defineSetting({
    key: 'payments.fx_max_rate_age_days',
    schema: z.number().int().min(0).max(31),
    default: 3,
    scopes: tenantOrProperty,
    description: 'How old (days before the business date) an exchange rate may be to be used',
  }),
};
