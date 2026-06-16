'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/lib/store';

export function ThemeProvider() {
  const theme = useUIStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return null;
}
