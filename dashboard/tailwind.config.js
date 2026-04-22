/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Use a custom class selector so our theme toggle script controls it
  // via <html class="theme-dark"> / <html class="theme-light">.
  darkMode: ['class', '.theme-dark'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist"', '"Geist Fallback"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', '"Geist Mono Fallback"', 'ui-monospace', 'monospace'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      colors: {
        // All colors resolve from CSS variables defined in index.css.
        // Light/dark palettes swap by toggling .theme-light / .theme-dark
        // on <html>.
        bg: {
          primary: 'var(--c-bg-primary)',
          secondary: 'var(--c-bg-secondary)',
          tertiary: 'var(--c-bg-tertiary)',
        },
        border: {
          DEFAULT: 'var(--c-border)',
        },
        fg: {
          primary: 'var(--c-fg-primary)',
          secondary: 'var(--c-fg-secondary)',
          tertiary: 'var(--c-fg-tertiary)',
        },
        sev: {
          critical: 'var(--c-sev-critical)',
          high: 'var(--c-sev-high)',
          medium: 'var(--c-sev-medium)',
          low: 'var(--c-sev-low)',
          info: 'var(--c-sev-info)',
          clean: 'var(--c-sev-clean)',
        },
        accent: {
          DEFAULT: 'var(--c-accent)',
        },
      },
    },
  },
  plugins: [],
}
