import type { Status } from '@/lib/status';

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

/** Every colour comes from the token table — no invented values. */
const INK = '#15181b';
const NEUTRAL = '#b3bac0';
const NEUTRAL_FILL = '#262a2f';

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
      ctx.fillStyle = '#ff8a7a';
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
      ctx.fillStyle = '#f2b23f';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    },
  },

  ON_TIME: filledCircle('#5ed69b', 7.5),

  // Hollow circle, no fill — the quietest marker in the set.
  TOMORROW: {
    draw: (ctx) => {
      circlePath(ctx, 7);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#858d94';
      ctx.stroke();
    },
  },

  // Square with a check.
  ARRIVED: {
    draw: (ctx) => {
      ctx.beginPath();
      ctx.rect(6, 6, 14, 14);
      ctx.fillStyle = '#9cc4e8';
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

  // Solid-outline circle. Same neutral pair as No appt and Stale GPS; told
  // apart by the border style, exactly as the chips are.
  UNASSIGNED: {
    draw: (ctx) => {
      circlePath(ctx, 7.2);
      ctx.fillStyle = NEUTRAL_FILL;
      ctx.fill();
      ctx.lineWidth = 1.5;
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

/** Rasterises all eight. Browser only — needs a canvas. */
export function renderMarkerImages(): MarkerImage[] {
  const out: MarkerImage[] = [];
  for (const [status, shape] of Object.entries(SHAPES) as [Status, Shape][]) {
    const canvas = document.createElement('canvas');
    canvas.width = MARKER_SIZE * SCALE;
    canvas.height = MARKER_SIZE * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.scale(SCALE, SCALE);
    shape.draw(ctx);
    out.push({
      id: markerImageId(status),
      data: ctx.getImageData(0, 0, canvas.width, canvas.height),
    });
  }
  return out;
}
