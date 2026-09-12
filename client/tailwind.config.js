/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FFF8EE',
        // Gray ramp darkened globally: the default Tailwind grays (400/500) washed out
        // on the violet canvas and white cards. Same names, AA-compliant values.
        gray: {
          300: '#8A8F98',
          400: '#5F6368',
          500: '#4B5563',
          600: '#374151',
          700: '#1F2937',
        },
        nb: {
          black: '#1a1a1a',
          /** Full-bleed violet canvas (reference: neobrutalism mockup) */
          canvas: '#8C7AE6',
          lime: '#C8F169',
          bubblegum: '#FFA3DD',
          orange: '#FF6B35',
          pink: '#FF69B4',
          yellow: '#FFD700',
          cyan: '#00D4AA',
          blue: '#4B9CD3',
          green: '#2ECC71',
          red: '#FF4757',
          purple: '#9B59B6',
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
      maxWidth: {
        // Real width of the 16rem (w-64) sidebar — used by the desktop Topbar offset
        sidebar: '16rem',
      },
      height: {
        // Dynamic viewport height: correct on mobile browsers with collapsing toolbars
        dvh: '100dvh',
      },
    },
  },
  plugins: [],
};
