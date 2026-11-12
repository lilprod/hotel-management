import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Segmented } from 'antd';

import { useUiStore } from './store';
import type { Language } from './store';

export interface LanguageSwitchProps {
  label?: string;
}

/** FR / EN switch bound to the UI store (apps sync i18next from the store). */
export function LanguageSwitch({ label = 'Language' }: LanguageSwitchProps) {
  const language = useUiStore((s) => s.language);
  const setLanguage = useUiStore((s) => s.setLanguage);
  return (
    <Segmented<Language>
      size="small"
      aria-label={label}
      value={language}
      onChange={setLanguage}
      options={[
        { label: 'FR', value: 'fr' },
        { label: 'EN', value: 'en' },
      ]}
    />
  );
}

export interface ThemeToggleProps {
  /** Accessible name; describes the action (e.g. "Switch to dark mode"). */
  label?: string;
}

export function ThemeToggle({ label = 'Toggle dark mode' }: ThemeToggleProps) {
  const mode = useUiStore((s) => s.mode);
  const toggleMode = useUiStore((s) => s.toggleMode);
  return (
    <Button
      type="text"
      aria-label={label}
      aria-pressed={mode === 'dark'}
      icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
      onClick={toggleMode}
    />
  );
}
