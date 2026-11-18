import { App as AntApp, ConfigProvider, theme as antTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import enUS from 'antd/locale/en_US';
import frFR from 'antd/locale/fr_FR';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { defaultBranding, ensureContrast, readableTextColor, sidebarPalette } from './branding';
import type { Branding } from './branding';
import { useUiStore } from './store';
import type { Language, ThemeMode } from './store';

const DARK_SURFACE = '#141414';

export function buildThemeConfig(branding: Branding, mode: ThemeMode): ThemeConfig {
  // On dark surfaces a very dark brand color would vanish: lighten it until it reads (3:1).
  const primary =
    mode === 'dark'
      ? ensureContrast(branding.primaryColor, DARK_SURFACE, 3, 1)
      : branding.primaryColor;
  const onPrimary = readableTextColor(primary);
  const sider = sidebarPalette(branding, mode);
  return {
    algorithm: mode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: primary,
      colorLink: primary,
      // Text drawn on primary surfaces (buttons, selected items) keeps WCAG AA.
      colorTextLightSolid: onPrimary,
      borderRadius: 6,
    },
    components: {
      Layout: { siderBg: sider.background, triggerBg: sider.background },
      Menu: {
        darkItemBg: sider.background,
        darkSubMenuItemBg: sider.background,
        darkItemColor: sider.text,
        darkItemHoverColor: sider.text,
        darkItemHoverBg: sider.hover,
        darkItemSelectedBg: sider.selectedBg,
        darkItemSelectedColor: sider.selectedText,
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
