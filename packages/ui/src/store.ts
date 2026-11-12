import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';
export type Language = 'fr' | 'en';

export const STORAGE_KEY = 'hm.ui';

interface Persisted {
  mode: ThemeMode;
  language: Language;
}

const defaults: Persisted = { mode: 'light', language: 'fr' };

function load(): Persisted {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const data = JSON.parse(raw) as Partial<Persisted>;
    return {
      mode: data.mode === 'dark' ? 'dark' : 'light',
      language: data.language === 'en' ? 'en' : 'fr',
    };
  } catch {
    return defaults;
  }
}

function save(state: Persisted): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode: state.mode, language: state.language }),
    );
  } catch {
    // storage unavailable (private mode, blocked): the preference stays in memory only
  }
}

export interface UiState extends Persisted {
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setLanguage: (language: Language) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  ...load(),
  setMode: (mode) => {
    set({ mode });
    save(get());
  },
  toggleMode: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
  setLanguage: (language) => {
    set({ language });
    save(get());
  },
}));
