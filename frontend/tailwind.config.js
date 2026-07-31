/** @type {import('tailwindcss').Config} */

/** Harmonized warm desk palette — wood / leather / paper / warm metal. */
/* Mapped onto warm desk tones, but keep readable steps on paper
 * (400/500 used as secondary text) and darker steps for emphasis. */
const earthSlate = {
  50: '#f2e6cc',
  100: '#ead9b8',
  200: '#dfcba0',
  300: '#b89a72',
  400: '#7a6552',
  500: '#5c4a3c',
  600: '#4a3424',
  700: '#3a2a1c',
  800: '#2c2118',
  900: '#2a1c12',
  950: '#1a120c',
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
          50: '#e2c47a', 100: '#c9a25a', 200: '#b89248', 300: '#9a7a3a',
          400: '#9a9084', 500: '#a89f92', 600: '#6e665c', 700: '#3a2a1c',
          800: '#2c2118', 900: '#2a1c12',
        },
        clinic: {
          50: '#f2e6cc',
          100: '#ead9b8',
          200: '#c9a25a',
          300: '#9a7a3a',
          400: '#9a9084',
          500: '#a89f92',
          600: '#6e665c',
          700: '#3a2a1c',
          800: '#2c2118',
          900: '#2a1c12',
          950: '#1a120c',
        },
        earth: {
          linen: '#f2e6cc',
          mist: '#ead9b8',
          stone: '#6a5848',
          clay: '#9a6548',
          bark: '#2c2118',
          moss: '#4a5c42',
          parchment: '#f2e6cc',
          groove: '#2a1c14',
          aluminum: '#9a9084',
          leather: '#3d2a1e',
          wood: '#3a2a1c',
          gold: '#c9a25a',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        raised:
          'inset 0 1px 0 rgba(255,245,220,0.55), 0 2px 4px rgba(30,18,10,0.22), 0 10px 22px rgba(20,10,4,0.2)',
        pressed:
          'inset 2px 2px 6px rgba(0,0,0,0.55), inset -1px -1px 2px rgba(201,162,90,0.12)',
        knob:
          'inset 0 1px 0 rgba(255,245,200,0.55), 0 1px 0 #6e5528, 0 4px 10px rgba(20,10,4,0.12)',
        wood:
          '4px 0 20px rgba(0,0,0,0.28)',
      },
      borderRadius: {
        panel: '1rem',
      },
      transitionTimingFunction: {
        fluid: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      backgroundImage: {
        linen: 'linear-gradient(180deg, #f4ead2 0%, #e6d4b0 100%)',
        wood: 'linear-gradient(160deg, #4a3424 0%, #3a2a1c 35%, #2a1c12 70%, #352418 100%)',
        aluminum: 'linear-gradient(135deg, #f2efe9 0%, #d2cbc0 48%, #a89f92 78%, #c4bcb0 100%)',
        leather: 'linear-gradient(165deg, #463022 0%, #342218 45%, #261810 100%)',
      },
    },
  },
  plugins: [],
};
