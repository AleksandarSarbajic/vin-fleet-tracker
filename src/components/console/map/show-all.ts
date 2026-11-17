import type { FleetRow } from '@/server/fleet-query';
import { MOTION_MS } from '@/design/tokens';
import { MAX_INITIAL_ZOOM, boundsOf, type Bounds } from './geo';

/**
 * §12.164, phase 3bx (QoL 7). Show all, in the map's controls: back to the fit of what the list
 * shows. `rows` are the map's own (`filtered` in Console: the list scope, the chips and the
 * search), so a chip or a search narrows what it fits.
 */

/** The fit's room around the trucks: the same as the fit on load. */
export const FIT_PADDING = 64;

/** What Show all would fit, or why it cannot: disabled with the reason, never hidden. */
export function showAllState(rows: readonly FleetRow[]): { bounds: Bounds } | { disabled: string } {
  if (rows.length === 0) return { disabled: 'The list shows no trucks, so there is nothing to fit.' };
  const bounds = boundsOf([...rows]);
  if (!bounds) return { disabled: 'No truck the list shows has a position yet.' };
  return { bounds };
}

/**
 * The fit, as the fit on load does it (its padding, its zoom floor so one truck is not a
 * rooftop), travelling as long as a selection's pan (the demo's `qFit`: the same token); under
 * reduced motion it fits without travelling.
 */
export function showAllFit(reducedMotion: boolean): { padding: number; maxZoom: number; duration: number } {
  return { padding: FIT_PADDING, maxZoom: MAX_INITIAL_ZOOM, duration: reducedMotion ? 0 : MOTION_MS.mapTravel };
}
