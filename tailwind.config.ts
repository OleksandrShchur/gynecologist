import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: 'var(--ivory)',
        plum: 'var(--plum)',
        muted: 'var(--muted)',
        violet: 'var(--violet)',
        lilac: 'var(--lilac)',
        greige: 'var(--greige)',
        sage: 'var(--sage)',
        line: 'var(--line)',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['Manrope', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
