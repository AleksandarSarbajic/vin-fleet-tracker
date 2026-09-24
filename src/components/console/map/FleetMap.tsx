'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Map, { Layer, Source, type MapMouseEvent, type MapRef } from 'react-map-gl/mapbox';
import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';
import type { Point } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import { clientEnv } from '@/env/client';
import type { FleetRow } from '@/server/fleet-query';
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  LAYER_CLUSTER_BUBBLE,
  LAYER_CLUSTERED_POINTS,
  LAYER_PROBLEM_POINTS,
  SOURCE_CLUSTERED,
  SOURCE_PROBLEM,
  SOURCE_SELECTION,
  SOURCE_TRAIL,
  clusterBubbleLayer,
  clusterCountLayer,
  clusteredPointsLayer,
  problemPointsLayer,
  renderClusterImages,
  selectionLayer,
  trailLayer,
} from './layers';
import { renderMarkerImages } from './markers';
import {
  MAX_INITIAL_ZOOM,
  US_FALLBACK,
  boundsOf,
  selectionCollection,
  splitForMap,
  trailCollection,
} from './geo';
import { MapPopup } from './MapPopup';
import { useTrail } from '@/hooks/useTrail';
import { trailDots } from '@/lib/trail';
import { BasemapToggle, MapFooter, MarkerKey, ZoomControl } from './MapChrome';
import { useBasemap } from '@/hooks/useBasemap';
import { BASEMAP_STYLE } from '@/lib/basemap';

/**
 * The map never re-renders per truck.
 *
 * Markers are Mapbox symbol layers reading from GeoJSON sources, not React
 * components wrapping DOM nodes. The default `<Marker>` approach repositions
 * a DOM node in JS on every frame of every pan; at 60 trucks with clusters
 * recomputing that visibly stutters. Here a poll is a single `setData` on
 * each source — Mapbox diffs and re-uploads internally, React renders nothing,
 * and 23 trucks cost the same as 60.
 *
 * Markers do not animate between fixes. design-spec §8.3 is "120ms ground and
 * selection, 150ms map pan, nothing else animates", and interpolating would
 * draw positions we do not have.
 */

const PAN_MS = 150;

interface Props {
  rows: FleetRow[];
  /** Reference instant for the popup's GPS age — see TruckRow on hydration. */
  fetchedAt: string | null;
  /**
   * §5.9. Every marker drops to the stale shape while the feed is down — a
   * green dot on a position nobody trusts is the same lie as a green row.
   */
  feedStale: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** §12.10's Enter, reachable from the map too. */
  onEdit: (id: string) => void;
  /** §14 feature 15. */
  onTimeline: (id: string) => void;
  /** Incremented on split drag-end. The map reflows then, never mid-drag. */
  resizeSignal: number;
  reducedMotion: boolean;
}

export function FleetMap({
  rows,
  fetchedAt,
  feedStale,
  selectedId,
  onSelect,
  onEdit,
  onTimeline,
  resizeSignal,
  reducedMotion,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const didFit = useRef(false);

  const { problem, clustered } = useMemo(
    () => splitForMap(rows, feedStale),
    [rows, feedStale],
  );
  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selection = useMemo(() => selectionCollection(selectedRow), [selectedRow]);

  const { basemap, ready: basemapReady, setBasemap } = useBasemap();
  /** Read by the image registration below, which runs from Mapbox events. */
  const basemapRef = useRef(basemap);
  useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);

  /**
   * Put every marker and cluster image into the CURRENT style.
   *
   * This used to run once, from `onLoad`. That was enough while the map had
   * one style for its whole life, and it is the thing a basemap toggle breaks
   * first: `setStyle` discards every image registered with `addImage`.
   * react-map-gl re-adds its `<Source>` and `<Layer>` children after a style
   * change; nothing re-adds the images, so every symbol layer would point at
   * an image that no longer exists and the fleet would silently vanish from
   * the map while the list went on showing it.
   *
   * `updateImage` when the id is already present rather than skipping it: the
   * two basemaps may be given different pixels for the same marker, and
   * skipping would leave the previous basemap's version in place.
   */
  const registerImages = useCallback((map: MapboxMap) => {
    const images = [...renderMarkerImages(basemapRef.current), ...renderClusterImages()];
    for (const { id, data } of images) {
      if (map.hasImage(id)) map.updateImage(id, data);
      else map.addImage(id, data, { pixelRatio: 2 });
    }
  }, []);

  /** Maps already wired, so `reuseMaps` re-mounting cannot double the listeners. */
  const wired = useRef(new WeakSet<MapboxMap>());

  /**
   * Wire the image listeners the moment the map EXISTS — a callback ref, not
   * `onLoad`.
   *
   * `onLoad` is too late, and was too late before any toggle existed: Mapbox
   * fires it after the first frame, and react-map-gl has already added the
   * symbol layers by then, so the first frame asked for `truck-*` images that
   * were not registered yet. Measured on the committed code before this
   * change: every page load logged `Image "truck-TOMORROW" could not be
   * loaded` and `Image "truck-UNASSIGNED" could not be loaded`, and those
   * markers were drawn a frame late.
   *
   * react-map-gl builds the map asynchronously and exposes no
   * `onStyleImageMissing` prop, so the ref is the earliest hook there is. It
   * fires as soon as the instance exists, and the style's own network fetch
   * is far slower than that.
   */
  const attachMap = useCallback(
    (ref: MapRef | null) => {
      mapRef.current = ref;
      const map = ref?.getMap();
      if (!map || wired.current.has(map)) return;
      wired.current.add(map);

      /**
       * Every style, including each basemap switch. `styleDiffing` is off on
       * the <Map> below, so a switch is always a full reload and always fires
       * this.
       */
      map.on('style.load', () => registerImages(map));
      /**
       * The race inside any load: a symbol layer drawn before `style.load` has
       * reached us. Mapbox asks for the image by id instead of drawing a hole;
       * this answers for ours and leaves any other id alone.
       */
      map.on('styleimagemissing', (event: { id: string }) => {
        if (event.id.startsWith('truck-') || event.id.startsWith('cluster')) {
          registerImages(map);
        }
      });
      if (map.isStyleLoaded()) registerImages(map);
    },
    [registerImages],
  );

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (didFit.current) return;
    didFit.current = true;
    const bounds = boundsOf(rows);
    if (!bounds) return; // No active truck has a position — keep the US view.
    map.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      {
        padding: 64,
        // Without this floor, one truck (or a fleet parked in one yard) drops
        // the dispatcher to street level looking at a rooftop.
        maxZoom: MAX_INITIAL_ZOOM,
        duration: 0,
      },
    );
  }, [rows]);

  /** Split drag-end only. During the drag Mapbox is simply not told. */
  useEffect(() => {
    if (resizeSignal === 0) return;
    mapRef.current?.getMap()?.resize();
  }, [resizeSignal]);

  /**
   * Pan when the SELECTION changes — never when positions update. Re-panning
   * on every poll would yank the viewport out from under the dispatcher every
   * 20 seconds.
   */
  useEffect(() => {
    if (!selectedRow || selectedRow.lat === null || selectedRow.lng === null) return;
    mapRef.current?.getMap()?.easeTo({
      center: [selectedRow.lng, selectedRow.lat],
      duration: reducedMotion ? 0 : PAN_MS,
    });
    // Only the id, so a position update for an already-selected truck moves
    // the marker without moving the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleClick = useCallback(
    (event: MapMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature) {
        onSelect(null);
        return;
      }

      if (feature.layer?.id === LAYER_CLUSTER_BUBBLE) {
        const map = mapRef.current?.getMap();
        const source = map?.getSource(SOURCE_CLUSTERED) as GeoJSONSource | undefined;
        const clusterId = feature.properties?.['cluster_id'] as number | undefined;
        if (!map || !source || clusterId === undefined) return;
        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error || zoom === null || zoom === undefined) return;
          const [lng, lat] = (feature.geometry as Point).coordinates as [number, number];
          map.easeTo({ center: [lng, lat], zoom, duration: reducedMotion ? 0 : PAN_MS });
        });
        return;
      }

      const id = feature.properties?.['id'];
      onSelect(typeof id === 'string' ? id : null);
    },
    [onSelect, reducedMotion],
  );

  const zoom = useCallback(
    (direction: 1 | -1) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      map.easeTo({
        zoom: map.getZoom() + direction,
        duration: reducedMotion ? 0 : PAN_MS,
      });
    },
    [reducedMotion],
  );

  /**
   * §14 feature 9. Selected-only (§14.3): nothing is fetched while nothing is
   * selected, and the dots are shaped against `fetchedAt` rather than a fresh
   * clock — the same reference every age on a row is measured from, so the
   * trail and the marker cannot disagree about how old a reading is.
   */
  const { data: trailPoints } = useTrail(selectedId);
  const trail = useMemo(
    () =>
      trailCollection(
        trailPoints
          ? trailDots(trailPoints, fetchedAt ? Date.parse(fetchedAt) : Date.now())
          : [],
      ),
    [trailPoints, fetchedAt],
  );

  /** Newest fix across the fleet — what the footer reports. */
  const newestPositionAt = useMemo(() => {
    let newest: string | null = null;
    for (const r of rows) {
      if (r.recordedAt && (!newest || r.recordedAt > newest)) newest = r.recordedAt;
    }
    return newest;
  }, [rows]);

  return (
    <div className="relative flex h-full w-full flex-col bg-surface-sunken">
      <div className="relative min-h-0 flex-1">
        <ZoomControl onZoom={zoom} />
        <BasemapToggle basemap={basemap} onChange={setBasemap} />
        <MarkerKey />
        {/*
          Not mounted until the stored basemap has been read. Mounting at the
          default and switching a frame later would load the dark style, fetch
          its tiles, and then throw both away for a satellite user on every
          page load — a visible flash, and work nobody asked for.
        */}
        {basemapReady ? (
        <Map
          ref={attachMap}
          mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
          mapStyle={BASEMAP_STYLE[basemap]}
          /*
           * A full reload on every switch, never a diff. The two styles share
           * nothing worth diffing, and a full reload is what guarantees
           * `style.load` fires — which is where the marker images go back in.
           *
           * Changing this prop calls `setStyle` on the SAME map instance, and
           * that is what keeps the toggle free: Mapbox bills per Map
           * constructed — the `map.load` telemetry event — and not per style.
           * Measured: a page load sends `map.load` once; three basemap
           * switches send `style.load` three times and `map.load` never.
           * e2e/basemap.spec.ts counts those events rather than trusting this.
           */
          styleDiffing={false}
          initialViewState={US_FALLBACK}
          onLoad={handleLoad}
          onClick={handleClick}
          interactiveLayerIds={[
            LAYER_CLUSTER_BUBBLE,
            LAYER_CLUSTERED_POINTS,
            LAYER_PROBLEM_POINTS,
          ]}
          cursor="default"
          attributionControl={false}
          reuseMaps
          style={{ width: '100%', height: '100%' }}
        >
          {/*
          The trail first of all, so the dots paint under the selection ring
          and under every marker. §14.5 wants "trail and head reading as one
          object", and the head has to be on top for that to be true.
        */}
          <Source id={SOURCE_TRAIL} type="geojson" data={trail}>
            <Layer {...trailLayer} />
          </Source>

          {/* Selection next, so its ring paints beneath the markers. */}
          <Source id={SOURCE_SELECTION} type="geojson" data={selection}>
            <Layer {...selectionLayer} />
          </Source>

          <Source
            id={SOURCE_CLUSTERED}
            type="geojson"
            data={clustered}
            cluster
            clusterMaxZoom={CLUSTER_MAX_ZOOM}
            clusterRadius={CLUSTER_RADIUS}
          >
            <Layer {...clusterBubbleLayer} />
            <Layer {...clusterCountLayer} />
            <Layer {...clusteredPointsLayer} />
          </Source>

          {/* Last, so problem markers paint above cluster bubbles. */}
          <Source id={SOURCE_PROBLEM} type="geojson" data={problem}>
            <Layer {...problemPointsLayer} />
          </Source>

          {selectedRow ? (
            <MapPopup
              row={selectedRow}
              fetchedAt={fetchedAt}
              onEdit={onEdit}
              onTimeline={onTimeline}
              onClose={() => onSelect(null)}
            />
          ) : null}
        </Map>
        ) : null}
      </div>
      <MapFooter
        fetchedAt={fetchedAt}
        newestPositionAt={newestPositionAt}
        basemap={basemap}
      />
    </div>
  );
}
