import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { useUiStore } from '@hm/ui';

import enBranding from './locales/en/branding.json';
import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enSettings from './locales/en/settings.json';
import frBranding from './locales/fr/branding.json';
import frCommon from './locales/fr/common.json';
import frNav from './locales/fr/nav.json';
import frSettings from './locales/fr/settings.json';

void i18n.use(initReactI18next).init({
  resources: {
    fr: { branding: frBranding, common: frCommon, nav: frNav, settings: frSettings },
    en: { branding: enBranding, common: enCommon, nav: enNav, settings: enSettings },
  },
  lng: useUiStore.getState().language,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  ns: ['branding', 'common', 'nav', 'settings'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
