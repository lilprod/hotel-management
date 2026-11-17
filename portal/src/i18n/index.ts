import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { useUiStore } from '@hm/ui/core';

import enCommon from './locales/en/common.json';
import enHome from './locales/en/home.json';
import enNav from './locales/en/nav.json';
import enPages from './locales/en/pages.json';
import enSite from './locales/en/site.json';
import frCommon from './locales/fr/common.json';
import frHome from './locales/fr/home.json';
import frNav from './locales/fr/nav.json';
import frPages from './locales/fr/pages.json';
import frSite from './locales/fr/site.json';

void i18n.use(initReactI18next).init({
  resources: {
    fr: { common: frCommon, nav: frNav, pages: frPages, home: frHome, site: frSite },
    en: { common: enCommon, nav: enNav, pages: enPages, home: enHome, site: enSite },
  },
  lng: useUiStore.getState().language,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  ns: ['common', 'nav', 'pages', 'home', 'site'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
