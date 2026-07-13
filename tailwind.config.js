/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'selector',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // canvas/cream/ink resolve through CSS custom properties (same
        // pattern as accent below) so :root.dark can redefine every one of
        // them in index.css without touching any of the ~120 component
        // files that already use these class names — the token NAME keeps
        // its semantic role (ink-900 = "most prominent ink amount") while
        // its actual value inverts per theme.
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        cream: {
          50:  'rgb(var(--cream-50)  / <alpha-value>)',
          100: 'rgb(var(--cream-100) / <alpha-value>)',
          200: 'rgb(var(--cream-200) / <alpha-value>)',
          300: 'rgb(var(--cream-300) / <alpha-value>)',
        },
        ink: {
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
        },
        accent: {
          50:  'rgb(var(--accent-50)  / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card:       '0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04)',
      },
      keyframes: {
        fadeSlideIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        wiggle: {
          '0%,100%': { transform: 'rotate(-3deg)' },
          '50%':     { transform: 'rotate(3deg)' },
        },
      },
      animation: {
        fadeSlideIn: 'fadeSlideIn 0.2s ease-out',
        wiggle:      'wiggle 0.3s ease-in-out',
      },
    },
  },
  plugins: [],
}


