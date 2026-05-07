// tailwind.config.ts — Tokens Tailwind ligados às CSS variables do dashboard
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-primary)',
        panel: 'var(--bg-secondary)',
        elevated: 'var(--bg-elevated)',
        line: 'var(--border)',
        muted: 'var(--text-secondary)',
        ink: 'var(--text-primary)',
        accent: 'var(--accent)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        success: 'var(--success)',
        cyan: '#2b8fbf'
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        panel: 'var(--shadow-panel)'
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '120% 0' },
          '100%': { backgroundPosition: '-120% 0' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s ease-in-out infinite'
      }
    }
  },
  plugins: []
}

export default config
