import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { errorMessages, useUiStore } from '@hm/ui';

/** Every `locales/<lng>/<namespace>.json` is a namespace (the error messages come from @hm/ui). */
function load(modules: Record<string, { default: Record<string, unknown> }>) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const ns = /\/([^/]+)\.json$/.exec(path)?.[1];
    if (ns) out[ns] = mod.default;
  }
  return out;
}

const fr = {
  ...load(import.meta.glob('./locales/fr/*.json', { eager: true })),
  errors: errorMessages.fr,
};
const en = {
  ...load(import.meta.glob('./locales/en/*.json', { eager: true })),
  errors: errorMessages.en,
};

void i18n.use(initReactI18next).init({
  resources: { fr, en },
  lng: useUiStore.getState().language,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  ns: Object.keys(fr),
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
