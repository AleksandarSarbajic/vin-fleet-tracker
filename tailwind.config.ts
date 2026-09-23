import type { Config } from 'tailwindcss';
import { palette } from './src/design/tokens';

/**
 * Type, spacing and motion from design-spec §2, §3 and §8.3. The colours live
 * in `src/design/tokens.ts` and are spread in here, because a canvas context
 * and a Mapbox paint property cannot take a class name and must read the same
 * values. No component may hardcode a hex: semantic status out of the engine,
 * token in the config, class in the component.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: palette,
      borderRadius: { DEFAULT: '0px', sm: '2px', md: '4px' },
      // §9.9's modal shadow. A component may not spell this out itself.
      boxShadow: { modal: '0 16px 48px rgba(0,0,0,.55)' },
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
      /**
       * §14.4's motion budget, in full. Every duration the fifteen features
       * use is named here; a component may not spell a millisecond figure.
       *
       * `flash` is 1600ms because the ground has to be readable long enough
       * to be noticed on a list that is also re-sorting, and `toast-out` is
       * shorter than `toast-in` so a dismissal never feels stuck.
       */
      transitionDuration: {
        ground: '120ms',
        map: '150ms',
        flash: '1600ms',
        chip: '160ms',
        'toast-in': '180ms',
        'toast-out': '120ms',
        overlay: '120ms',
      },
      transitionTimingFunction: {
        // Jumps, then decays: the flash is at full ground on frame one.
        flash: 'cubic-bezier(.2,0,0,1)',
        toast: 'cubic-bezier(.2,.8,.2,1)',
      },
      /**
       * §14.4's density pair. The row heights are a token rather than a
       * component constant because the bulk bar, the fold footer and the
       * pinned block all have to agree with them (§14.5).
       */
      spacing: {
        'row-comfortable': '44px',
        'row-compact': '32px',
        'chip-comfortable': '21px',
        'chip-compact': '18px',
      },
    },
  },
  plugins: [],
};

export default config;
