import type { Status } from '@/lib/status';
import { palette } from '@/design/tokens';
import type { Basemap } from '@/lib/basemap';

/**
 * The eight status markers, drawn once to canvases and handed to Mapbox with
 * `map.addImage`. After that a marker costs nothing per frame: the GPU draws
 * it from an atlas and a position update is a single `source.setData` call.
 *
 * Shape is the primary channel, hue the second (design-spec §5.3) — the set is
 * legible in greyscale. Rendered at 2x for retina.
 *
 * NOT rotated by heading. Rotating a status shape would corrupt the very
 * channel the greyscale-safe system depends on: a triangle turned on its side
 * stops reading as the Late triangle. Heading is a popup fact instead
 * ("62 mph · heading W", §9.3) — which is also where the design puts it.
 */

export const MARKER_SIZE = 26;
const SCALE = 2;
const C = MARKER_SIZE / 2;

/**
 * A canvas context takes a colour string, not a class, so this is one of the
 * two places allowed to read the palette directly. Nothing here is invented:
 * every value is the same token the chips use.
 */
const INK = palette.surface.base;
const NEUTRAL = palette.status.neutral.fg;
const NEUTRAL_FILL = palette.status.neutral.bg;

/* ------------------------------------------------------------------------ *
 * Satellite: every marker sits on a plate (§12.70)
 * ------------------------------------------------------------------------ */

/**
 * The dark ground each marker was designed against, carried with it.
 *
 * Measured at the 22 trucks' real positions, zoom 9 and 13, the imagery under
 * this fleet is MID-TONE — median relative luminance 0.139. Every marker in
 * the dark-map set separates from its ground with one of two pairs: a light
 * fill inside a dark stroke, or a dark fill inside a light stroke. Both pairs
 * straddle mid-grey, so on mid-grey ground both edges go weak at once:
 *
 *     Tomorrow   passes 3:1 at  0% of locations, worst 1.00 (invisible)
 *     Stale GPS  passes 3:1 at 30%
 *     No appt    passes 3:1 at 55%
 *     Unassigned passes 3:1 at 68%
 *
 * The plate fixes that without redesigning a single marker. Inside it, each
 * glyph sits on exactly the ground it was drawn for, so Tomorrow stays hollow
 * and quietest, the shape channel (§5.3) is untouched, and the dark-map
 * contrast work still holds.
 */
export const PLATE_FILL = palette.surface.base;
export const PLATE_RIM = palette.text.DEFAULT;

/**
 * The plate then has to separate from the imagery, and it does so for EVERY
 * possible ground rather than for the samples that happened to be measured.
 * Against ground luminance L the rim's ratio falls as L rises and the plate's
 * rises; the worst case is where they cross, and at that point both are
 * 3.84:1. `markers.test.ts` sweeps L from 0 to 1 to hold that.
 */
const PLATE_RADIUS = 12;
const PLATE_RIM_WIDTH = 1.25;

/**
 * The glyph, scaled about the centre, so its outermost corner clears the rim.
 * The image keeps its 26px box — Mapbox's `updateImage` requires identical
 * dimensions, and one box size for both basemaps keeps icon placement the
 * same — so the plate costs the glyph 18% of its size. Late's triangle
 * corner, the furthest point in the set at 11.4px, lands at 9.9px against the
 * rim's inner edge at 11.4px.
 */
const GLYPH_ON_PLATE = 0.82;

function drawPlate(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(C, C, PLATE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = PLATE_FILL;
  ctx.fill();
  ctx.lineWidth = PLATE_RIM_WIDTH;
  ctx.strokeStyle = PLATE_RIM;
  ctx.stroke();
}

interface Shape {
  draw: (ctx: CanvasRenderingContext2D) => void;
}

function circlePath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.arc(C, C, r, 0, Math.PI * 2);
}

function filledCircle(fill: string, r: number): Shape {
  return {
    draw: (ctx) => {
      circlePath(ctx, r);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    },
  };
}

/**
 * Diagonal hatch for STALE_GPS, stroked directly into the marker rather than
 * built as a CanvasPattern.
 *
 * The pattern approach did not survive contact with a real map. The tile was
 * created from an already `scale(2,2)`-ed context, so its 4px pitch came out
 * at 16 logical px against a 14.4px circle — at most one faint line crossed
 * the shape, and on tiles the marker read as an empty ring. Stroking the lines
 * under a clip is both simpler and actually visible.
 */
function hatchCircle(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.save();
  circlePath(ctx, r);
  ctx.clip();
  ctx.strokeStyle = NEUTRAL;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  // 45 degrees, 3.5px apart, swept wide enough to cover the whole box.
  for (let x = -MARKER_SIZE; x < MARKER_SIZE * 2; x += 3.5) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + MARKER_SIZE, MARKER_SIZE);
  }
  ctx.stroke();
  ctx.restore();
}

const SHAPES: Record<Status, Shape> = {
  // Triangle, point up.
  LATE: {
    draw: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(C, 4);
      ctx.lineTo(22, 20);
      ctx.lineTo(4, 20);
      ctx.closePath();
      ctx.fillStyle = palette.status.late.fg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    },
  },

  // Diamond.
  AT_RISK: {
    draw: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(C, 4);
      ctx.lineTo(21, C);
      ctx.lineTo(C, 20);
      ctx.lineTo(5, C);
      ctx.closePath();
      ctx.fillStyle = palette.status.risk.fg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    },
  },

  ON_TIME: filledCircle(palette.status.ontime.fg, 7.5),

  // Hollow circle, no fill — the quietest marker in the set.
  TOMORROW: {
    draw: (ctx) => {
      circlePath(ctx, 7);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.status.tomorrow.fg;
      ctx.stroke();
    },
  },

  // Square with a check.
  ARRIVED: {
    draw: (ctx) => {
      ctx.beginPath();
      ctx.rect(6, 6, 14, 14);
      ctx.fillStyle = palette.status.arrived.fg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(9.5, 13);
      ctx.lineTo(11.8, 15.3);
      ctx.lineTo(16.5, 10.3);
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.stroke();
    },
  },

  // Dashed circle with a question mark.
  NO_APPT: {
    draw: (ctx) => {
      circlePath(ctx, 7.2);
      ctx.fillStyle = NEUTRAL_FILL;
      ctx.fill();
      ctx.setLineDash([3, 2.6]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = NEUTRAL;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(12.25, 12, 1.7, Math.PI, Math.PI * 2.35);
      ctx.moveTo(13, 13.4);
      ctx.lineTo(13, 14.4);
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = NEUTRAL;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(13, 16.4, 0.6, 0, Math.PI * 2);
      ctx.fillStyle = NEUTRAL;
      ctx.fill();
    },
  },

  // Hatched circle with a dotted edge.
  STALE_GPS: {
    draw: (ctx) => {
      circlePath(ctx, 7.2);
      ctx.fillStyle = NEUTRAL_FILL;
      ctx.fill();
      hatchCircle(ctx, 7.2);
      circlePath(ctx, 7.2);
      ctx.setLineDash([1.5, 2.2]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = NEUTRAL;
      ctx.stroke();
      ctx.setLineDash([]);
    },
  },

  // Solid-outline circle with a slash: ⊘. Same neutral pair as No appt and
  // Stale GPS; told apart by the border style, exactly as the chips are.
  //
  // The slash closes §13.4. Without it this was a grey ring whose dark fill
  // vanishes into dark ground — Tomorrow's silhouette, one step of grey
  // lighter — and the plate (§12.70) put the two side by side on identical
  // ground. The mark is the chip's own driver-slash (StatusChip.tsx, same
  // top-left to bottom-right direction), so it adds no hue and no new
  // vocabulary; it is one line, ring to ring, and heavier than Stale GPS's
  // hatch so a single stroke never reads as a sparse hatch.
  UNASSIGNED: {
    draw: (ctx) => {
      circlePath(ctx, 7.2);
      ctx.fillStyle = NEUTRAL_FILL;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = NEUTRAL;
      ctx.stroke();
      const d = 7.2 * Math.SQRT1_2;
      ctx.beginPath();
      ctx.moveTo(C - d, C - d);
      ctx.lineTo(C + d, C + d);
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.strokeStyle = NEUTRAL;
      ctx.stroke();
    },
  },
};

export const markerImageId = (status: Status): string => `truck-${status}`;

export interface MarkerImage {
  id: string;
  data: ImageData;
}

/**
 * Rasterises all eight. Browser only — needs a canvas.
 *
 * On the dark basemap the plate code path does not run: seven of the eight
 * images are byte-identical to the pre-satellite ones (checked in the browser
 * against the previous commit's renderer). Unassigned differs on both
 * basemaps, deliberately — it gained its slash (§13.4).
 */
export function renderMarkerImages(basemap: Basemap = 'dark'): MarkerImage[] {
  const out: MarkerImage[] = [];
  for (const [status, shape] of Object.entries(SHAPES) as [Status, Shape][]) {
    const canvas = document.createElement('canvas');
    canvas.width = MARKER_SIZE * SCALE;
    canvas.height = MARKER_SIZE * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.scale(SCALE, SCALE);
    if (basemap === 'satellite') {
      drawPlate(ctx);
      ctx.translate(C, C);
      ctx.scale(GLYPH_ON_PLATE, GLYPH_ON_PLATE);
      ctx.translate(-C, -C);
    }
    shape.draw(ctx);
    out.push({
      id: markerImageId(status),
      data: ctx.getImageData(0, 0, canvas.width, canvas.height),
    });
  }
  return out;
}
