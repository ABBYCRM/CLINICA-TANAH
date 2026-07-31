/** @type {import('tailwindcss').Config} */

/** Warm parchment / aluminum neutrals — skeuomorphic desk language. */
const earthSlate = {
  50: '#f4efe6',
  100: '#e8dfd1',
  200: '#d9cebd',
  300: '#cfc3b0',
  400: '#b0b7c0',
  500: '#6b645a',
  600: '#5c564c',
  700: '#4a453c',
  800: '#3a342c',
  900: '#2c2822',
  950: '#1a1814',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: earthSlate,
        gray: earthSlate,
        zinc: earthSlate,
        neutral: earthSlate,
        primary: {
          50: '#f4efe6', 100: '#e8dfd1', 200: '#d9cebd', 300: '#cfc3b0',
          400: '#b0b7c0', 500: '#9CA3AF', 600: '#6B7280', 700: '#4b5563',
          800: '#3a342c', 900: '#2c2822',
        },
        clinic: {
          50: '#f4efe6',
          100: '#e8dfd1',
          200: '#d9cebd',
          300: '#cfc3b0',
          400: '#b0b7c0',
          500: '#9CA3AF',
          600: '#6B7280',
          700: '#4b5563',
          800: '#3a342c',
          900: '#2c2822',
          950: '#1a1814',
        },
        earth: {
          linen: '#f4efe6',
          mist: '#e8dfd1',
          stone: '#6b645a',
          clay: '#a08060',
          bark: '#3a342c',
          moss: '#6B7280',
          parchment: '#E8DFD1',
          groove: '#D9CEBD',
          aluminum: '#9CA3AF',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        raised:
          'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(58,52,44,0.08), 0 1px 2px rgba(58,52,44,0.06), 0 6px 16px rgba(58,52,44,0.10)',
        pressed:
          'inset 2px 2px 5px rgba(0,0,0,0.25), inset -1px -1px 2px rgba(255,255,255,0.7)',
        knob:
          'inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 0 #4b5563, 0 6px 14px rgba(55,65,81,0.28)',
        wood:
          '4px 0 15px rgba(0,0,0,0.12)',
      },
      borderRadius: {
        panel: '1rem',
      },
      transitionTimingFunction: {
        fluid: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      backgroundImage: {
        linen:
          'radial-gradient(rgba(255,255,255,0.4) 1px, transparent 0), linear-gradient(165deg, #f0e8dc 0%, #e8dfd1 48%, #d9d0c2 100%)',
        wood:
          'radial-gradient(rgba(255,255,255,0.4) 1px, transparent 0)',
        aluminum:
          'linear-gradient(135deg, #E5E7EB 0%, #D1D5DB 50%, #9CA3AF 100%)',
      },
    },
  },
  plugins: [],
};
