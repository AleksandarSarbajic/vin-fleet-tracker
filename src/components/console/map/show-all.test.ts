import { describe, expect, it } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { MOTION_MS } from '@/design/tokens';
import { MAX_INITIAL_ZOOM } from './geo';
import { FIT_PADDING, showAllFit, showAllState } from './show-all';

/** Phase 3bx, QoL 7 (§12.164): what Show all fits, or why it cannot, and how it travels. */

const at = (lat: number | null, lng: number | null, n: number) => fleetRow({ id: `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, lat, lng });

describe('Show all (QoL 7)', () => {
  it('fits what the rows hold, those with a position', () => {
    expect(showAllState([at(41.85, -87.65, 1), at(32.78, -96.8, 2), at(null, null, 3)])).toEqual({
      bounds: { west: -96.8, south: 32.78, east: -87.65, north: 41.85 },
    });
  });

  it('nothing shown: disabled, with the reason', () => {
    expect(showAllState([])).toEqual({ disabled: 'The list shows no trucks, so there is nothing to fit.' });
    expect(showAllState([at(null, null, 1)])).toEqual({ disabled: 'No truck the list shows has a position yet.' });
  });

  it("travels as long as a selection's pan, fits as the load's fit does, and under reduced motion does not travel", () => {
    expect(showAllFit(false)).toEqual({ padding: FIT_PADDING, maxZoom: MAX_INITIAL_ZOOM, duration: MOTION_MS.mapTravel });
    expect(MOTION_MS.mapTravel).toBe(700);
    expect(showAllFit(true)).toEqual({ padding: FIT_PADDING, maxZoom: MAX_INITIAL_ZOOM, duration: 0 });
  });
});
