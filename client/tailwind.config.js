/** @type {import('tailwindcss').Config} */

/* ═══════════════════════════════════════════════════════════════════
   ZOCLO DESIGN TOKENS — single source of truth for the whole theme.
   Youthful Maximalist Neo-Brutalism: milk-cream matte canvas, midnight
   charcoal ink linework (never #000), one electric accent trio, and
   fresh utility pastels. Change a value here → the whole app reskins.
   ═══════════════════════════════════════════════════════════════════ */
const tokens = {
  canvas: '#FAF7F2',   // Core canvas — soft milk-cream, non-glare matte matrix
  chalk:  '#F3EFE9',   // Alt canvas — ultra-pale vintage chalk-white (sections, wells)
  ink:    '#0F172A',   // Structural anchor — near-black midnight charcoal (text, borders, shadows)
  // Accent engine (high-energy identity trio)
  violet: '#6D28D9',   // Primary identity — headings, badges, match action states
  pink:   '#F43F5E',   // Confessions + hearts — category labels, match triggers, danger
  yellow: '#FBBF24',   // Attention — banners, unread alerts, secondary highlights
  // Utility balance (fresh pastels)
  mint:   '#10B981',   // Verified check, "Active now" indicators
  peri:   '#60A5FA',   // Secondary buttons, utility nav chips, comment pills
  // Support tints (accents for decorative moments only)
  lilac:  '#C4B5FD',   // Anonymous persona + soft violet surfaces
  cream:  '#FAF7F2',   // Alias of canvas for tinted wells on white cards
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: tokens.ink,
        chalk: tokens.chalk,
        // Darkened gray ramp for secondary text on cream/white (AA-safe)
        gray: {
          300: '#8A8F98',
          400: '#5F6368',
          500: '#4B5563',
          600: '#374151',
          700: '#1F2937',
        },
        /* ── Zoclo canonical palette (use these) ── */
        nb: {
          ink: tokens.ink,
          canvas: tokens.canvas,
          chalk: tokens.chalk,
          cream: tokens.cream,
          violet: tokens.violet,
          pink: tokens.pink,
          yellow: tokens.yellow,
          mint: tokens.mint,
          peri: tokens.peri,
          lilac: tokens.lilac,
        },
        /* ── Legacy aliases (old class names keep working, now mapped
              to the Zoclo palette). Safe to migrate away gradually. ── */
        black: tokens.ink,                                  // nb-black → ink
        orange: tokens.violet,                              // primary → electric violet
        lime: tokens.yellow,                                // selected → sunflower
        cyan: tokens.peri,                                  // chat/utility → periwinkle
        blue: tokens.peri,                                  // saved/verified → periwinkle
        red: tokens.pink,                                   // likes/danger → watermelon
        purple: tokens.lilac,                               // anonymous → soft lilac
        bubblegum: tokens.lilac,                            // decorative → lilac
        green: tokens.mint,                                 // success → mint
        pink: tokens.pink,
        yellow: tokens.yellow,
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      borderWidth: {
        // Razor-sharp linework — 1.5px to 2px max, never thick cartoonish outlines
        nb: '2px',
        'nb-2': '1.5px',
        'nb-3': '2px',
      },
      borderRadius: {
        // Strict 90-degree angles across all elements
        none: '0',
        nb: '0',
        'nb-lg': '0',
        'nb-xl': '0',
      },
      boxShadow: {
        // Solid, unblurred 3D hard shadows — always the midnight ink
        nb: `3px 3px 0px 0px ${tokens.ink}`,
        'nb-sm': `2px 2px 0px 0px ${tokens.ink}`,
        'nb-lg': `6px 6px 0px 0px ${tokens.ink}`,
        // Hover: crisp mechanical lift — offset grows 3px → 6px
        'nb-hover': `6px 6px 0px 0px ${tokens.ink}`,
        // Active: fully pressed — shadow disappears entirely
        'nb-active': `0px 0px 0px 0px ${tokens.ink}`,
      },
      maxWidth: {
        // Real width of the w-64 sidebar — used by the desktop Topbar offset
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
