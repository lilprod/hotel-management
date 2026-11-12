import { App as AntApp, ConfigProvider, theme as antTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import enUS from 'antd/locale/en_US';
import frFR from 'antd/locale/fr_FR';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { defaultBranding } from './branding';
import type { Branding } from './branding';
import { useUiStore } from './store';
import type { Language, ThemeMode } from './store';

export function buildThemeConfig(branding: Branding, mode: ThemeMode): ThemeConfig {
  return {
    algorithm: mode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: branding.primaryColor,
      colorLink: branding.primaryColor,
      borderRadius: 6,
    },
    components: {
      Layout: { siderBg: branding.secondaryColor, triggerBg: branding.secondaryColor },
      Menu: {
        darkItemBg: branding.secondaryColor,
        darkSubMenuItemBg: branding.secondaryColor,
        darkItemSelectedBg: branding.primaryColor,
      },
    },
  };
}

export interface HmThemeProviderProps {
  branding?: Branding;
  /** Defaults to the value held by `useUiStore`. */
  mode?: ThemeMode;
  /** Defaults to the value held by `useUiStore`. */
  language?: Language;
  children: ReactNode;
}

export function HmThemeProvider({
  branding = defaultBranding,
  mode: modeProp,
  language: languageProp,
  children,
}: HmThemeProviderProps) {
  const storeMode = useUiStore((s) => s.mode);
  const storeLanguage = useUiStore((s) => s.language);
  const mode = modeProp ?? storeMode;
  const language = languageProp ?? storeLanguage;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset['theme'] = mode;
    root.style.colorScheme = mode;
    root.lang = language;
  }, [mode, language]);

  return (
    <ConfigProvider
      theme={buildThemeConfig(branding, mode)}
      locale={language === 'en' ? enUS : frFR}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
