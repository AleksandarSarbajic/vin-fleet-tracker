'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Map, {
  Layer,
  Source,
  type MapMouseEvent,
  type MapRef,
} from 'react-map-gl/mapbox';
import type { GeoJSONSource } from 'mapbox-gl';
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
  clusterBubbleLayer,
  clusterCountLayer,
  clusteredPointsLayer,
  problemPointsLayer,
  renderClusterImages,
  selectionLayer,
} from './layers';
import { renderMarkerImages } from './markers';
import {
  MAX_INITIAL_ZOOM,
  US_FALLBACK,
  boundsOf,
  selectionCollection,
  splitForMap,
} from './geo';
import { MapPopup } from './MapPopup';
import { MapFooter, MarkerKey, ZoomControl } from './MapChrome';

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
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** §12.10's Enter, reachable from the map too. */
  onEdit: (id: string) => void;
  /** Incremented on split drag-end. The map reflows then, never mid-drag. */
  resizeSignal: number;
  reducedMotion: boolean;
}

export function FleetMap({
  rows,
  fetchedAt,
  selectedId,
  onSelect,
  onEdit,
  resizeSignal,
  reducedMotion,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const didFit = useRef(false);

  const { problem, clustered } = useMemo(() => splitForMap(rows), [rows]);
  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selection = useMemo(() => selectionCollection(selectedRow), [selectedRow]);

  /** Register the marker and cluster images once, before any layer needs them. */
  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    for (const { id, data } of [...renderMarkerImages(), ...renderClusterImages()]) {
      if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: 2 });
    }

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
      <MarkerKey />
      <Map
        ref={mapRef}
        mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
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
        {/* Selection first, so its ring paints beneath the markers. */}
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
            onClose={() => onSelect(null)}
          />
        ) : null}
      </Map>
      </div>
      <MapFooter fetchedAt={fetchedAt} newestPositionAt={newestPositionAt} />
    </div>
  );
}
