import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { useUiStore } from '@hm/ui';

import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import frCommon from './locales/fr/common.json';
import frNav from './locales/fr/nav.json';

void i18n.use(initReactI18next).init({
  resources: {
    fr: { common: frCommon, nav: frNav },
    en: { common: enCommon, nav: enNav },
  },
  lng: useUiStore.getState().language,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  ns: ['common', 'nav'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
