'use client';

import { useUIStore, type ThemeName } from '@/lib/store';
import { cn } from '@/lib/cn';

const THEMES: { name: ThemeName; label: string; color: string }[] = [
  { name: 'enterprise',   label: 'Enterprise',  color: '#1e3a5f' },
  { name: 'modern',       label: 'Modern',      color: '#4f46e5' },
  { name: 'minimal',      label: 'Minimal',     color: '#111827' },
  { name: 'ai-command',   label: 'AI Command',  color: '#7c3aed' },
  { name: 'mobile-first', label: 'Mobile',      color: '#0f766e' },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useUIStore();

  return (
    <div className="flex flex-wrap gap-3">
      {THEMES.map(({ name, label, color }) => (
        <button
          key={name}
          data-theme-option={name}
          onClick={() => setTheme(name)}
          className={cn(
            'flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all',
            theme === name ? 'border-[--color-accent] shadow-sm' : 'border-gray-200 hover:border-gray-300'
          )}
          aria-label={`Switch to ${label} theme`}
          aria-pressed={theme === name}
        >
          <div
            className="w-8 h-8 rounded-full"
            style={{ background: color }}
          />
          <span className="text-xs text-gray-600 font-medium">{label}</span>
        </button>
      ))}
    </div>
  );
}
