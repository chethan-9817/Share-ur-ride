/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // Women-safety accent
        safe: { 50: '#fdf2f8', 100: '#fce7f3', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d' },
        ink: { 950: '#0b0b14', 900: '#12121d', 800: '#1b1b29', 700: '#272738' },
      },
      boxShadow: { soft: '0 8px 30px -12px rgb(0 0 0 / 0.18)' },
      keyframes: {
        radar: { '0%': { transform: 'scale(0.4)', opacity: '0.9' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
        'slide-up': { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        radar: 'radar 2.4s cubic-bezier(0, 0, 0.2, 1) infinite',
        'slide-up': 'slide-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
