import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0A0A0A',
        surface: '#141414',
        surfaceHigh: '#1E1E1E',
        border: '#2A2A2A',
        accent: {
          DEFAULT: '#F59E0B',
          hover: '#D97706',
          muted: '#78350F',
        },
        textPrimary: '#F5F5F5',
        textMuted: '#737373',
        danger: '#EF4444',
        success: '#22C55E',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}

export default config
