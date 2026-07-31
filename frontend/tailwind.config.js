/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Earthly moss / stone / clay — remapped clinic tokens for skeuomorphism
        primary: {
          50: '#f3f7f2', 100: '#e2ebe0', 200: '#c5d6c3', 300: '#9bb89a',
          400: '#6f9470', 500: '#527554', 600: '#3f5c42', 700: '#334a36',
          800: '#2b3d2e', 900: '#243328',
        },
        clinic: {
          50: '#f3f7f2',
          100: '#e2ebe0',
          200: '#c5d6c3',
          300: '#9bb89a',
          400: '#6f9470',
          500: '#527554',
          600: '#3f5c42',
          700: '#334a36',
          800: '#2b3d2e',
          900: '#1f2c22',
          950: '#141c16',
        },
        earth: {
          linen: '#e7eee4',
          mist: '#d5dfd2',
          stone: '#6d665c',
          clay: '#8a6a45',
          bark: '#3a2f26',
          moss: '#3f5c42',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        raised:
          'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(40,55,35,0.08), 0 1px 2px rgba(40,55,35,0.06), 0 6px 16px rgba(40,55,35,0.10)',
        pressed:
          'inset 0 2px 5px rgba(40,55,35,0.18), inset 0 1px 0 rgba(0,0,0,0.04)',
        knob:
          'inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 0 #2a4430, 0 6px 14px rgba(30,50,35,0.28)',
        wood:
          'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.35), 4px 0 24px rgba(0,0,0,0.25)',
      },
      borderRadius: {
        panel: '1rem',
      },
      transitionTimingFunction: {
        fluid: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      backgroundImage: {
        linen:
          'radial-gradient(ellipse at 20% 10%, rgba(255,255,255,0.45), transparent 45%), radial-gradient(ellipse at 80% 0%, rgba(143,166,130,0.18), transparent 40%), linear-gradient(165deg, #e9f0e6 0%, #d7e1d3 48%, #cfdac9 100%)',
        wood:
          'linear-gradient(180deg, #2d3f31 0%, #223328 42%, #1a261e 100%)',
      },
    },
  },
  plugins: [],
};
