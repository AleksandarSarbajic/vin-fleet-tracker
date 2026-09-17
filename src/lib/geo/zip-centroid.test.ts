import { describe, expect, it } from 'vitest';
import { ZIP_CENTROID_VINTAGE, zipCentroid } from './zip-centroid';

/**
 * §12.30. The last resort in the geocoding chain, and the only link in it
 * that cannot fail because someone else's service is down.
 */
describe('zipCentroid', () => {
  it('finds the ZIP that started all this — Elwood IL, the CenterPoint ramp', () => {
    const z = zipCentroid('60421')!;
    expect(z).not.toBeNull();
    // Elwood is south-west of Chicago.
    expect(z.lat).toBeCloseTo(41.41, 1);
    expect(z.lng).toBeCloseTo(-88.08, 1);
    // A big rural-edge ZIP: ~60 sq mi of land, so ~4.4 mi of radius.
    expect(z.radiusMiles).toBeGreaterThan(3);
    expect(z.radiusMiles).toBeLessThan(6);
  });

  it('takes the 5-digit ZIP out of a ZIP+4', () => {
    expect(zipCentroid('60421-1234')).toEqual(zipCentroid('60421'));
  });

  it('is null rather than wrong for something that is not a ZIP', () => {
    expect(zipCentroid(null)).toBeNull();
    expect(zipCentroid('')).toBeNull();
    expect(zipCentroid('ABCDE')).toBeNull();
    expect(zipCentroid('123')).toBeNull();
    // A syntactically fine ZIP that no ZCTA covers.
    expect(zipCentroid('00000')).toBeNull();
  });

  it('carries the whole country, not a sample', () => {
    // Every state this fleet has touched, plus the awkward ones.
    for (const zip of ['58203', '56560', '60433', '85043', '30336', '75212', '80216', '84104']) {
      expect(zipCentroid(zip), zip).not.toBeNull();
    }
  });

  it('records the vintage, because a centroid file silently ages', () => {
    expect(ZIP_CENTROID_VINTAGE).toBe('2023');
  });

  it('puts every centroid inside the United States', () => {
    // A cheap guard on the generated file: a parsing slip that swapped lat
    // and lng would put the whole fleet in the Indian Ocean, quietly.
    for (const zip of ['60421', '58203', '85043', '99501', '96813']) {
      const z = zipCentroid(zip)!;
      expect(z.lat, zip).toBeGreaterThan(15);
      expect(z.lat, zip).toBeLessThan(72);
      expect(z.lng, zip).toBeLessThan(-64);
      expect(z.lng, zip).toBeGreaterThan(-180);
    }
  });
});
