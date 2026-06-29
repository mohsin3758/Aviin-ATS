'use client';
import { createContext, useContext, useEffect, useState } from 'react';

export type ThemeName =
  | 'corporate-navy'
  | 'modern-purple'
  | 'ocean-blue'
  | 'emerald-dark'
  | 'warm-sunrise'
  | 'minimal-slate';

export const THEMES: { id: ThemeName; name: string; preview: string; dark?: boolean }[] = [
  { id: 'corporate-navy',  name: 'Corporate Navy',  preview: '#1e3a5f' },
  { id: 'modern-purple',   name: 'Modern Purple',   preview: '#7c3aed' },
  { id: 'ocean-blue',      name: 'Ocean Blue',      preview: '#0369a1' },
  { id: 'emerald-dark',    name: 'Emerald Dark',    preview: '#10b981', dark: true },
  { id: 'warm-sunrise',    name: 'Warm Sunrise',    preview: '#ea580c' },
  { id: 'minimal-slate',   name: 'Minimal Slate',   preview: '#334155' },
];

const ThemeContext = createContext<{
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}>({ theme: 'corporate-navy', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>('corporate-navy');

  useEffect(() => {
    const saved = localStorage.getItem('aviin-theme') as ThemeName | null;
    if (saved) {
      setThemeState(saved);
      document.documentElement.setAttribute('data-theme', saved);
    }
  }, []);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    localStorage.setItem('aviin-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
