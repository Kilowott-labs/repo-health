/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist"', '"Geist Fallback"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', '"Geist Mono Fallback"', 'ui-monospace', 'monospace'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      colors: {
        // Linear-inspired muted palette, dark-mode defaults
        bg: {
          primary: '#0A0A0A',
          secondary: '#141414',
          tertiary: '#1F1F1F',
        },
        border: {
          DEFAULT: '#2A2A2A',
        },
        fg: {
          primary: '#F5F5F4',
          secondary: '#A8A29E',
          tertiary: '#57534E',
        },
        sev: {
          critical: '#C2410C',
          high: '#D97706',
          medium: '#CA8A04',
          low: '#65A30D',
          info: '#475569',
          clean: '#166534',
        },
        accent: {
          DEFAULT: '#84CC16',
        },
      },
    },
  },
  plugins: [],
}
