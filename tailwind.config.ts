import type { Config } from 'tailwindcss';

/**
 * Lifted from design-spec.md §1 (design doc 2g theme extension), verbatim.
 * Every contrast ratio in the spec was independently verified — do not
 * retype or "tidy" these values. No component may hardcode a hex: semantic
 * status out of the engine, token here, class in the component.
 *
 * Light theme (spec §1.2) is deliberately NOT implemented — it is specified
 * but incomplete (no line/row/neutral values, no measured ratios). Dark is
 * the only theme QA signs off. See spec §12.16.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          sunken: '#0f1215',
          base: '#15181b',
          raised: '#1d2126',
          overlay: '#252a30',
        },
        line: {
          hair: 'rgb(255 255 255 / .13)',
          soft: 'rgb(255 255 255 / .08)',
        },
        text: {
          DEFAULT: '#e9ebed',
          secondary: '#a9b0b6',
          muted: '#858d94',
          inverse: '#15181b',
          mutedOnSelected: '#949ca4',
        },
        row: {
          hover: '#1d2126',
          selected: '#1b222b',
          // Unassigned rows sit marginally sunken — inert, not urgent (4a).
          unassigned: '#1b1e21',
        },
        brand: { navy: '#0d2b6b', cyan: '#29b6d8' },
        accent: {
          DEFAULT: '#94bce3',
          hover: '#b5d3ef',
          press: '#749dc4',
        },
        status: {
          late: { fg: '#ff8a7a', bg: '#3a1f1c', bd: '#6b3129' },
          risk: { fg: '#f2b23f', bg: '#3a2c15', bd: '#6b5224' },
          ontime: { fg: '#5ed69b', bg: '#15301f', bd: '#27573a' },
          tomorrow: {
            fg: '#858d94',
            bg: 'transparent',
            bd: 'rgb(255 255 255 / .14)',
          },
          arrived: { fg: '#9cc4e8', bg: '#1c2a38', bd: '#37516b' },
          neutral: { fg: '#b3bac0', bg: '#262a2f', bd: '#6e767d' },
        },
        // Search match plate — steel, never yellow; yellow is At risk (2d).
        highlight: '#3d4a57',
      },
      borderRadius: { DEFAULT: '0px', sm: '2px', md: '4px' },
      fontFamily: {
        sans: ['Barlow', 'system-ui', 'sans-serif'],
        cond: ['Barlow Condensed', 'system-ui', 'sans-serif'],
      },
      // Spec §2. Six sizes, nothing else.
      fontSize: {
        display: ['22px', { lineHeight: '1.1', letterSpacing: '.04em' }],
        header: ['15px', { lineHeight: '1', letterSpacing: '.14em' }],
        data: ['14px', { lineHeight: '1.2' }],
        body: ['12.5px', { lineHeight: '1.45' }],
        small: ['11.5px', { lineHeight: '1.5' }],
        micro: ['10.5px', { lineHeight: '1', letterSpacing: '.11em' }],
      },
      transitionDuration: { ground: '120ms', map: '150ms' },
    },
  },
  plugins: [],
};

export default config;
