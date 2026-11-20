/**
 * Regional defaults of a new establishment, by ISO country code. This is configuration data:
 * no tax or legal rule lives here (those come from `tax_rules`, `settings` and the adapters).
 * v1 targets Togo (doc 09); the neighbouring XOF countries are listed so that the self-service
 * signup can accept them once their `tax_rules` are loaded.
 */
export interface CountryDefaults {
  currency: string;
  timezone: string;
  /** International dialling code, without `+`. */
  dialCode: string;
}

export const COUNTRY_DEFAULTS: Readonly<Record<string, CountryDefaults>> = {
  TG: { currency: 'XOF', timezone: 'Africa/Lome', dialCode: '228' },
  BJ: { currency: 'XOF', timezone: 'Africa/Porto-Novo', dialCode: '229' },
  CI: { currency: 'XOF', timezone: 'Africa/Abidjan', dialCode: '225' },
  SN: { currency: 'XOF', timezone: 'Africa/Dakar', dialCode: '221' },
  BF: { currency: 'XOF', timezone: 'Africa/Ouagadougou', dialCode: '226' },
  ML: { currency: 'XOF', timezone: 'Africa/Bamako', dialCode: '223' },
  NE: { currency: 'XOF', timezone: 'Africa/Niamey', dialCode: '227' },
};

export const DEFAULT_COUNTRY = 'TG';

export const SIGNUP_COUNTRIES = Object.keys(COUNTRY_DEFAULTS) as [string, ...string[]];

export function countryDefaults(country: string): CountryDefaults | undefined {
  return COUNTRY_DEFAULTS[country];
}
