import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { errorMessages, useUiStore } from '@hm/ui';

import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enPlatform from './locales/en/platform.json';
import frAuth from './locales/fr/auth.json';
import frCommon from './locales/fr/common.json';
import frNav from './locales/fr/nav.json';
import frPlatform from './locales/fr/platform.json';

void i18n.use(initReactI18next).init({
  resources: {
    fr: {
      auth: frAuth,
      common: frCommon,
      errors: errorMessages.fr,
      nav: frNav,
      platform: frPlatform,
    },
    en: {
      auth: enAuth,
      common: enCommon,
      errors: errorMessages.en,
      nav: enNav,
      platform: enPlatform,
    },
  },
  lng: useUiStore.getState().language,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  ns: ['auth', 'common', 'errors', 'nav', 'platform'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
