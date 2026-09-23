import type { Config } from 'tailwindcss';
import { EASING, MOTION_MS, palette } from './src/design/tokens';

/**
 * Type, spacing and motion from design-spec §2, §3 and §8.3. The colours live
 * in `src/design/tokens.ts` and are spread in here, because a canvas context
 * and a Mapbox paint property cannot take a class name and must read the same
 * values. No component may hardcode a hex: semantic status out of the engine,
 * token in the config, class in the component.
 */
/** The one place a duration becomes CSS. */
const ms = (n: number): string => `${n}ms`;

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
       * The numbers come from `MOTION_MS` rather than being typed here,
       * because `useRowFlash` and the toast's exit have to outlive their own
       * animations and were reading a second copy of the same figures.
       *
       * `flash` is 1600ms because the ground has to be readable long enough
       * to be noticed on a list that is also re-sorting, and `toast-out` is
       * shorter than `toast-in` so a dismissal never feels stuck.
       */
      transitionDuration: {
        ground: ms(MOTION_MS.ground),
        map: ms(MOTION_MS.map),
        flash: ms(MOTION_MS.flash),
        chip: ms(MOTION_MS.chip),
        'toast-in': ms(MOTION_MS.toastIn),
        'toast-out': ms(MOTION_MS.toastOut),
        overlay: ms(MOTION_MS.overlay),
      },
      transitionTimingFunction: {
        flash: EASING.flash,
        toast: EASING.toast,
      },
      /**
       * §14.4, the half a transition cannot express.
       *
       * A transition needs two renders with different values; these four all
       * start the moment the element MOUNTS, which has only one. The flash
       * ground, the toast's 8px rise, the overlay's fade and the chip's
       * crossfade are keyframes for that reason and no other.
       *
       * Every one ends on the value it should rest at — `forwards` or `both`
       * — so nothing snaps back on the frame after it finishes.
       */
      keyframes: {
        /**
         * The flash rides an overlay above the row's ground, not the ground
         * itself: the resting colour underneath is `row.checked`, `row.hover`
         * or nothing at all, and a keyframe cannot know which of the three it
         * would have to land on.
         */
        'flash-decay': { from: { opacity: '1' }, to: { opacity: '0' } },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'toast-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        flash: `flash-decay ${ms(MOTION_MS.flash)} ${EASING.flash} forwards`,
        'toast-in': `toast-in ${ms(MOTION_MS.toastIn)} ${EASING.toast} both`,
        'toast-out': `toast-out ${ms(MOTION_MS.toastOut)} ${EASING.toast} forwards`,
        // Opacity only, 120ms. No scale and no slide: these open over a list
        // that may be moving, and a panel that also moves reads as a jump.
        overlay: `fade-in ${ms(MOTION_MS.overlay)} linear both`,
        chip: `fade-in ${ms(MOTION_MS.chip)} ${EASING.toast} both`,
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
