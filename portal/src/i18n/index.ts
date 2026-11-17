import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { errorMessages, useUiStore } from '@hm/ui/core';

import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enHome from './locales/en/home.json';
import enNav from './locales/en/nav.json';
import enPages from './locales/en/pages.json';
import enSite from './locales/en/site.json';
import frAuth from './locales/fr/auth.json';
import frCommon from './locales/fr/common.json';
import frHome from './locales/fr/home.json';
import frNav from './locales/fr/nav.json';
import frPages from './locales/fr/pages.json';
import frSite from './locales/fr/site.json';

/** Shared `errors` namespace plus the portal-specific `meta.reason` messages. */
function withReasons<T extends { reason: object }>(base: T, extra: Record<string, string>) {
  return { ...base, reason: { ...base.reason, ...extra } };
}

void i18n.use(initReactI18next).init({
  resources: {
    fr: {
      auth: frAuth,
      errors: withReasons(errorMessages.fr, frAuth.errorReasons),
      common: frCommon,
      nav: frNav,
      pages: frPages,
      home: frHome,
      site: frSite,
    },
    en: {
      auth: enAuth,
      errors: withReasons(errorMessages.en, enAuth.errorReasons),
      common: enCommon,
      nav: enNav,
      pages: enPages,
      home: enHome,
      site: enSite,
    },
  },
  lng: useUiStore.getState().language,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  ns: ['auth', 'errors', 'common', 'nav', 'pages', 'home', 'site'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
