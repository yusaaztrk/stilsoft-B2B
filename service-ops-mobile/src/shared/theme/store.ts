import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'settings/theme';

export type Theme = 'dark' | 'light';

type ThemeState = {
  theme: Theme;
  hydrated: boolean;
  setTheme: (t: Theme) => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'light',
  hydrated: false,

  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(THEME_KEY);
      set({ theme: (saved as Theme) ?? 'light', hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setTheme: async (t: Theme) => {
    set({ theme: t });
    try {
      await AsyncStorage.setItem(THEME_KEY, t);
    } catch {}
  },
}));

// ──────────────────────────────────────────────
// Colour tokens for both themes
// ──────────────────────────────────────────────
export const DARK = {
  bg: '#0a0a0a',
  surface: 'rgba(255,255,255,0.04)',
  surfaceBorder: 'rgba(255,255,255,0.08)',
  text: '#ffffff',
  textSub: 'rgba(255,255,255,0.5)',
  textMuted: 'rgba(255,255,255,0.3)',
  accent: '#B91C1C',
  accentLight: 'rgba(185,28,28,0.15)',
  divider: 'rgba(255,255,255,0.06)',
  tabBarBg: '#111',
  tabBarBorder: 'rgba(255,255,255,0.1)',
  orb1: 'rgba(183,58,11,0.10)',
  orb2: 'rgba(122,12,12,0.10)',
  card: '#111827',
  inputBg: 'rgba(255,255,255,0.05)',
  inputBorder: 'rgba(255,255,255,0.1)',
  placeholder: 'rgba(255,255,255,0.3)',
  badgeNeutralBg: 'rgba(255,255,255,0.1)',
  badgeNeutralText: 'rgba(255,255,255,0.7)',
};

export const LIGHT = {
  bg: '#f5f5f7',
  surface: '#ffffff',
  surfaceBorder: 'rgba(0,0,0,0.08)',
  text: '#111111',
  textSub: 'rgba(0,0,0,0.5)',
  textMuted: 'rgba(0,0,0,0.35)',
  accent: '#B91C1C',
  accentLight: 'rgba(185,28,28,0.08)',
  divider: 'rgba(0,0,0,0.06)',
  tabBarBg: '#ffffff',
  tabBarBorder: 'rgba(0,0,0,0.1)',
  orb1: 'rgba(185,28,28,0.06)',
  orb2: 'rgba(185,28,28,0.04)',
  card: '#ffffff',
  inputBg: 'rgba(0,0,0,0.04)',
  inputBorder: 'rgba(0,0,0,0.1)',
  placeholder: 'rgba(0,0,0,0.3)',
  badgeNeutralBg: 'rgba(0,0,0,0.06)',
  badgeNeutralText: 'rgba(0,0,0,0.6)',
};

export type ThemeColors = typeof DARK;

export function useThemeColors(): ThemeColors {
  const theme = useThemeStore((s) => s.theme);
  return theme === 'light' ? LIGHT : DARK;
}
