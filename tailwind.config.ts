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
      transitionDuration: { ground: '120ms', map: '150ms' },
    },
  },
  plugins: [],
};

export default config;
