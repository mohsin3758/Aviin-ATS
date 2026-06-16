'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeName = 'enterprise' | 'modern' | 'minimal' | 'ai-command' | 'mobile-first';

interface UIState {
  theme: ThemeName;
  sidebarCollapsed: boolean;
  setTheme: (t: ThemeName) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'enterprise',
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: 'airecruit-theme',
      partialize: (s) => ({ theme: s.theme }),
    }
  )
);
