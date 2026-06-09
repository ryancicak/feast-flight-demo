/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0a0e14',
        panel: '#121826',
        'panel-2': '#0f141f',
        hairline: '#1e293b',
        accent: '#38bdf8',
        'risk-low': '#22c55e',
        'risk-mid': '#f59e0b',
        'risk-high': '#ef4444',
        ink: '#e8edf5',
        'ink-dim': '#94a3b8',
        'ink-faint': '#64748b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.4), 0 8px 28px rgba(0,0,0,0.35)',
        glow: '0 0 24px rgba(56,189,248,0.35)',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.82)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        pulseDot: 'pulseDot 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
