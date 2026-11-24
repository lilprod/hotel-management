import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { errorMessages, useUiStore } from '@hm/ui';

import enAuth from './locales/en/auth.json';
import enBranding from './locales/en/branding.json';
import enCommon from './locales/en/common.json';
import enFrontDesk from './locales/en/frontDesk.json';
import enNav from './locales/en/nav.json';
import enReservations from './locales/en/reservations.json';
import enOnboarding from './locales/en/onboarding.json';
import enSecurity from './locales/en/security.json';
import enSignup from './locales/en/signup.json';
import enSettings from './locales/en/settings.json';
import enSubscription from './locales/en/subscription.json';
import frAuth from './locales/fr/auth.json';
import frBranding from './locales/fr/branding.json';
import frCommon from './locales/fr/common.json';
import frFrontDesk from './locales/fr/frontDesk.json';
import frNav from './locales/fr/nav.json';
import frReservations from './locales/fr/reservations.json';
import frOnboarding from './locales/fr/onboarding.json';
import frSecurity from './locales/fr/security.json';
import frSignup from './locales/fr/signup.json';
import frSettings from './locales/fr/settings.json';
import frSubscription from './locales/fr/subscription.json';

void i18n.use(initReactI18next).init({
  resources: {
    fr: {
      auth: frAuth,
      branding: frBranding,
      common: frCommon,
      errors: errorMessages.fr,
      frontDesk: frFrontDesk,
      nav: frNav,
      onboarding: frOnboarding,
      reservations: frReservations,
      security: frSecurity,
      signup: frSignup,
      settings: frSettings,
      subscription: frSubscription,
    },
    en: {
      auth: enAuth,
      branding: enBranding,
      common: enCommon,
      errors: errorMessages.en,
      frontDesk: enFrontDesk,
      nav: enNav,
      onboarding: enOnboarding,
      reservations: enReservations,
      security: enSecurity,
      signup: enSignup,
      settings: enSettings,
      subscription: enSubscription,
    },
  },
  lng: useUiStore.getState().language,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  ns: [
    'auth',
    'branding',
    'common',
    'errors',
    'frontDesk',
    'nav',
    'reservations',
    'security',
    'settings',
    'signup',
    'subscription',
  ],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
