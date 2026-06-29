/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        'primary-dark': 'var(--color-primary-dark)',
        accent: 'var(--color-accent)',
        surface: 'var(--color-surface)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        card: 'var(--color-card-shadow)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease',
        'slide-in': 'slideIn 0.2s ease',
      },
    },
  },
  plugins: [],
};
