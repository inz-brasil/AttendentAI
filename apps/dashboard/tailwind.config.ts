// tailwind.config.ts — Design tokens Tailwind do dashboard
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#08090a',
        panel: '#111315',
        elevated: '#191c1f',
        line: '#2a2f35',
        muted: '#8d97a3',
        ink: '#f4f7fb',
        accent: '#f7ff6a',
        cyan: '#79e2ff',
        success: '#31d18b',
        danger: '#ff5f72'
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(255,255,255,0.08)'
      },
      keyframes: {
        'pulse-once': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '30%': { backgroundColor: 'rgba(247,255,106,0.10)' }
        }
      },
      animation: {
        'pulse-once': 'pulse-once 2s ease-in-out 1'
      }
    }
  },
  plugins: []
}

export default config
