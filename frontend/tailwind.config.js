/** @type {import('tailwindcss').Config} */

/** Wood / leather / paper / metal skeuomorphic materials. */
const earthSlate = {
  50: '#f3e6c8',
  100: '#e8d5a8',
  200: '#d4af6a',
  300: '#a8843d',
  400: '#8a929c',
  500: '#6b5646',
  600: '#5a3822',
  700: '#3b2416',
  800: '#2a1f16',
  900: '#1c120a',
  950: '#120a06',
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
          50: '#f0d48a', 100: '#d4af6a', 200: '#c9a055', 300: '#a8843d',
          400: '#8a929c', 500: '#9aa3ae', 600: '#5c6570', 700: '#3b2416',
          800: '#2a1f16', 900: '#1c120a',
        },
        clinic: {
          50: '#f3e6c8',
          100: '#e8d5a8',
          200: '#d4af6a',
          300: '#a8843d',
          400: '#8a929c',
          500: '#9aa3ae',
          600: '#5c6570',
          700: '#3b2416',
          800: '#2a1f16',
          900: '#1c120a',
          950: '#120a06',
        },
        earth: {
          linen: '#f3e6c8',
          mist: '#e8d5a8',
          stone: '#6b5646',
          clay: '#9a5a42',
          bark: '#2a1f16',
          moss: '#3d5c3a',
          parchment: '#f3e6c8',
          groove: '#3a2618',
          aluminum: '#9aa3ae',
          leather: '#4a2f22',
          wood: '#3b2416',
          gold: '#d4af6a',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        raised:
          'inset 0 1px 0 rgba(255,255,255,0.65), 0 8px 18px rgba(20,10,4,0.35), 0 22px 40px rgba(10,5,2,0.28)',
        pressed:
          'inset 3px 3px 8px rgba(0,0,0,0.65), inset -1px -1px 2px rgba(212,175,106,0.18)',
        knob:
          'inset 0 1px 0 rgba(255,245,200,0.65), 0 2px 0 #5a4018, 0 6px 16px rgba(20,10,4,0.45)',
        wood:
          '6px 0 28px rgba(0,0,0,0.45)',
      },
      borderRadius: {
        panel: '1rem',
      },
      transitionTimingFunction: {
        fluid: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      backgroundImage: {
        linen:
          'linear-gradient(180deg, #f7ecd0 0%, #f0e0b8 55%, #e6d2a4 100%)',
        wood:
          'linear-gradient(115deg, #1a1008 0%, #3d2616 36%, #2e1c10 52%, #6a442c 68%, #160e08 100%)',
        aluminum:
          'linear-gradient(135deg, #f2f4f7 0%, #c8ced6 42%, #9aa3ae 72%, #b8bfc8 100%)',
        leather:
          'linear-gradient(165deg, #5c3a28 0%, #3e271c 40%, #2a1a12 70%, #4a3022 100%)',
      },
    },
  },
  plugins: [],
};
