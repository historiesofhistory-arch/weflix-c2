/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      colors: {
        gray: {
          900: '#121212',
          800: '#1f1f1f',
          700: '#2d2d2d',
          600: '#404040',
        }
      },
      aspectRatio: {
        '16/7': '16 / 7',
        '2/3': '2 / 3',
        '3/2': '3 / 2',
      },
      screens: {
        'xs': '475px',
        'mobile': {'max': '767px'},
      },
      spacing: {
        'safe-area-bottom': 'env(safe-area-inset-bottom, 1rem)',
      },
    },
  },
  plugins: [
    require('tailwindcss-scrollbar'),
  ],
}
