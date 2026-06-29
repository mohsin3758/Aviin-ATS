'use client';
import { useTheme, THEMES } from '@/components/providers/ThemeProvider';
import { Palette, Check } from 'lucide-react';
import { useState } from 'react';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
        style={{ color: 'var(--color-sidebar-text)' }}
        title="Switch theme"
      >
        <Palette className="h-4 w-4" />
        <span className="hidden lg:block">Theme</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-2 w-64 rounded-xl shadow-2xl border overflow-hidden z-50 animate-fade-in"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="p-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
              Choose Dashboard Theme
            </p>
          </div>
          <div className="p-2 grid grid-cols-2 gap-1.5">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => { setTheme(t.id); setOpen(false); }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all hover:opacity-90"
                style={{
                  background: theme === t.id ? t.preview + '18' : 'transparent',
                  border: `1.5px solid ${theme === t.id ? t.preview : 'transparent'}`,
                }}
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: t.preview }}
                >
                  {theme === t.id && <Check className="h-3 w-3 text-white" />}
                </div>
                <div>
                  <div className="text-xs font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
                    {t.name}
                  </div>
                  {t.dark && <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Dark</div>}
                </div>
              </button>
            ))}
          </div>
          <div className="p-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
              Preference saved automatically
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
