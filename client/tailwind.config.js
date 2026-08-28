/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FFF8EE',
        nb: {
          black: '#1a1a1a',
          orange: '#FF6B35',
          pink: '#FF69B4',
          yellow: '#FFD700',
          cyan: '#00D4AA',
          blue: '#4B9CD3',
          green: '#2ECC71',
          red: '#FF4757',
          purple: '#9B59B6',
          beige: '#FFF8EE',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      boxShadow: {
        nb: '4px 4px 0px 0px #1a1a1a',
        'nb-sm': '2px 2px 0px 0px #1a1a1a',
        'nb-lg': '6px 6px 0px 0px #1a1a1a',
        'nb-hover': '6px 6px 0px 0px #1a1a1a',
        'nb-active': '1px 1px 0px 0px #1a1a1a',
      },
      borderRadius: {
        nb: '12px',
        'nb-lg': '16px',
        'nb-xl': '24px',
      },
      borderWidth: {
        nb: '3px',
        'nb-2': '2px',
      },
    },
  },
  plugins: [],
};
