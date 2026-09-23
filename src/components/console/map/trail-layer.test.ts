import { describe, expect, it } from 'vitest';
import { trailCollection } from './geo';
import { LAYER_TRAIL, trailLayer } from './layers';
import { TRAIL_RAMP, palette } from '@/design/tokens';
import { trailDots } from '@/lib/trail';

/**
 * §14.5's two hard constraints on the trail, as assertions rather than
 * comments:
 *
 * > Dots, no stroke, 4–5px — smaller than any marker (14px+) and **never a
 * > line**, so a future route preview can own the solid line.
 *
 * "Never a line" is the one that has to survive a refactor. A trail drawn as
 * a line layer would have to be undrawn before a route preview could exist,
 * and the reason would be a sentence in a spec nobody re-reads.
 */

const NOW = Date.parse('2026-09-23T18:00:00.000Z');
const points = Array.from({ length: 61 }, (_, i) => ({
  lat: 41 + i / 1000,
  lng: -87,
  recordedAt: new Date(NOW - i * 30_000).toISOString(),
}));

describe('the layer', () => {
  it('is circles, never a line', () => {
    expect(trailLayer.type).toBe('circle');
    expect(trailLayer.id).toBe(LAYER_TRAIL);
  });

  it('draws no stroke — a stroke makes a 4px dot read as a ring', () => {
    expect(trailLayer.paint?.['circle-stroke-width']).toBe(0);
  });

  it('reads radius and opacity from the feature, so the ramp has one home', () => {
    expect(trailLayer.paint?.['circle-radius']).toEqual(['get', 'radius']);
    expect(trailLayer.paint?.['circle-opacity']).toEqual(['get', 'opacity']);
  });

  /** Mapbox parses colours with its own parser and cannot take a class. */
  it('takes its colour from the token', () => {
    expect(trailLayer.paint?.['circle-color']).toBe(palette.trail);
  });
});

describe('the collection', () => {
  it('carries the ramp onto the features, newest first', () => {
    const features = trailCollection(trailDots(points, NOW)).features;
    expect(features).toHaveLength(TRAIL_RAMP.length);
    expect(features.map((f) => f.properties.opacity)).toEqual([...TRAIL_RAMP]);
  });

  it('stays inside §14.5’s 4–5px', () => {
    for (const feature of trailCollection(trailDots(points, NOW)).features) {
      expect(feature.properties.radius).toBeGreaterThanOrEqual(4);
      expect(feature.properties.radius).toBeLessThanOrEqual(5);
    }
  });

  it('writes GeoJSON’s lng, lat order and not the row’s lat, lng', () => {
    const [first] = trailCollection(trailDots(points, NOW)).features;
    expect(first?.geometry.coordinates).toEqual([-87, 41.001]);
  });

  it('is an empty collection when nothing is selected', () => {
    expect(trailCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
