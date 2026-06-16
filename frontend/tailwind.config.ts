import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const themeVariants = plugin(({ addVariant }) => {
  // per-template Tailwind variant: `theme-modern:text-indigo-600` etc.
  for (const t of ['modern', 'minimal', 'ai-command', 'mobile-first']) {
    addVariant(`theme-${t}`, `[data-theme="${t}"] &`);
  }
  // enterprise is the baseline (no variant needed — default styles)
});

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Template color tokens — set as CSS custom properties by data-theme on <html>
        primary: 'var(--color-primary)',
        'primary-dark': 'var(--color-primary-dark)',
        secondary: 'var(--color-secondary)',
        accent: 'var(--color-accent)',
        surface: 'var(--color-surface)',
        'surface-alt': 'var(--color-surface-alt)',
        muted: 'var(--color-muted)',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-in-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [themeVariants, require('tailwindcss-animate')],
};

export default config;
