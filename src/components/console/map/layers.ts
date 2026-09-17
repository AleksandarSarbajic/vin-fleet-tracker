import type { CircleLayerSpecification, SymbolLayerSpecification } from 'mapbox-gl';
import { STATUSES } from '@/lib/status';
import { markerImageId } from './markers';

/**
 * design-spec §12.6: no clustering above zoom 6 — clusters break apart as you
 * zoom in past it. The document says "break below zoom 6", which is backwards.
 *
 * TODO: confirm against real dark-v11 tiles; 6 was chosen against a placeholder.
 */
export const CLUSTER_MAX_ZOOM = 6;
export const CLUSTER_RADIUS = 50;

export const SOURCE_CLUSTERED = 'trucks-clustered';
export const SOURCE_PROBLEM = 'trucks-problem';
export const SOURCE_SELECTION = 'truck-selection';

export const LAYER_SELECTION = 'truck-selection-ring';
export const LAYER_CLUSTER_BUBBLE = 'cluster-bubble';
export const LAYER_CLUSTER_COUNT = 'cluster-count';
export const LAYER_CLUSTERED_POINTS = 'trucks-clustered-points';
export const LAYER_PROBLEM_POINTS = 'trucks-problem-points';

/** Cluster bubble sizes from `3c` / `3d`: 34 at 5, 38 at 7, 42 at 14, 48 at 24. */
export const CLUSTER_SIZES = [34, 38, 42, 48] as const;
export const clusterImageId = (size: number): string => `cluster-${size}`;

/** Picks the bubble image by how many trucks it holds. */
const clusterIcon: unknown = [
  'step',
  ['get', 'point_count'],
  clusterImageId(34),
  7,
  clusterImageId(38),
  12,
  clusterImageId(42),
  20,
  clusterImageId(48),
];

/** Status -> marker image. Adding a status is adding an image, not a branch. */
const statusIcon: unknown = [
  'match',
  ['get', 'status'],
  ...STATUSES.flatMap((s) => [s, markerImageId(s)]),
  markerImageId('ON_TIME'),
];

/**
 * Selection is its own one-feature source drawn UNDER the marker, rather than
 * `setFeatureState`. Feature state cannot reach a point that has been rolled
 * into a cluster; a separate source always can.
 */
export const selectionLayer: CircleLayerSpecification = {
  id: LAYER_SELECTION,
  type: 'circle',
  source: SOURCE_SELECTION,
  paint: {
    'circle-radius': 17,
    'circle-color': 'rgba(148,188,227,0.14)',
    'circle-stroke-width': 2,
    'circle-stroke-color': '#94bce3',
  },
};

export const clusterBubbleLayer = {
  id: LAYER_CLUSTER_BUBBLE,
  type: 'symbol',
  source: SOURCE_CLUSTERED,
  filter: ['has', 'point_count'],
  layout: {
    'icon-image': clusterIcon,
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  },
} as unknown as SymbolLayerSpecification;

export const clusterCountLayer = {
  id: LAYER_CLUSTER_COUNT,
  type: 'symbol',
  source: SOURCE_CLUSTERED,
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    // Mapbox renders text from its own glyph atlas, which has no Barlow.
    // This is the one place in the product that is not Barlow — see the
    // note in FleetMap.tsx.
    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
    'text-size': 13,
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  },
  paint: {
    'text-color': '#e9ebed',
    // Problem markers are drawn ABOVE cluster bubbles on purpose, so a
    // co-located late truck can land on top of a bubble and bury its count.
    // The halo keeps the number readable through it.
    'text-halo-color': '#1d2126',
    'text-halo-width': 1.5,
  },
} as unknown as SymbolLayerSpecification;

/** Individual trucks from the clustered source, once they are not clustered. */
export const clusteredPointsLayer = {
  id: LAYER_CLUSTERED_POINTS,
  type: 'symbol',
  source: SOURCE_CLUSTERED,
  filter: ['!', ['has', 'point_count']],
  layout: {
    'icon-image': statusIcon,
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  },
} as unknown as SymbolLayerSpecification;

/**
 * Problem markers. Declared last so they paint ABOVE cluster bubbles — a late
 * truck must never end up behind one.
 */
export const problemPointsLayer = {
  id: LAYER_PROBLEM_POINTS,
  type: 'symbol',
  source: SOURCE_PROBLEM,
  layout: {
    'icon-image': statusIcon,
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  },
} as unknown as SymbolLayerSpecification;

/** Draws the cluster bubbles: square, raised ground, 1px accent border. */
export function renderClusterImages(): { id: string; data: ImageData }[] {
  const out: { id: string; data: ImageData }[] = [];
  const dpr = 2;
  for (const size of CLUSTER_SIZES) {
    const canvas = document.createElement('canvas');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1d2126';
    ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#94bce3';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    out.push({
      id: clusterImageId(size),
      data: ctx.getImageData(0, 0, canvas.width, canvas.height),
    });
  }
  return out;
}
