import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngBoundsExpression, LatLngTuple, LeafletEvent, LeafletMouseEvent } from 'leaflet';
import type { TrackPoint, LapBoundary } from '../fit/display';
import { nearestPointByTime } from '../fit/display';
import 'leaflet/dist/leaflet.css';

const lapIcon = L.divIcon({ className: 'lap-marker-icon', iconSize: [14, 14] });
const previewIcon = L.divIcon({ className: 'lap-marker-icon lap-marker-icon--preview', iconSize: [12, 12] });

/** Fits the map to the route once, when it first appears — never again, so the
 * user's own pan/zoom isn't clobbered by unrelated re-renders (e.g. clicking
 * the track, editing laps). */
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      // Leaflet measures the container at construction time; in a flex layout
      // the container can still resize after that, leaving it fitting to a
      // stale (often too-small) size and zooming out further than necessary.
      // Force a re-measure immediately before fitting.
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [24, 24] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Fits the map to the selected/zoomed chart range's track segment, and back
 * to the full route when the selection is cleared. Deliberately keyed only on
 * the selection's own timestamps (not on `points`/`fullBounds`, which get new
 * array/object identities on every unrelated re-render, e.g. lap edits or
 * hover) — reading them from the closure at fire-time is correct since this
 * effect should only ever run when the selection itself actually changes.
 */
function SelectionBounds({
  points,
  selectedRange,
  fullBounds,
  resetSignal,
}: {
  points: TrackPoint[];
  selectedRange: { start: Date; end: Date } | null | undefined;
  fullBounds: LatLngBoundsExpression | null;
  /** Bumped on every "Reset zoom" click. Included in the dependency array so
   * the map re-fits to the full route even when `selectedRange` was already
   * null (e.g. the user zoomed/panned the map directly, not via the chart). */
  resetSignal?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (selectedRange) {
      const startMs = selectedRange.start.getTime();
      const endMs = selectedRange.end.getTime();
      const segment: LatLngTuple[] = points
        .filter(
          (p) => p.lat !== null && p.lon !== null && p.timestamp.getTime() >= startMs && p.timestamp.getTime() <= endMs,
        )
        .map((p) => [p.lat as number, p.lon as number]);
      if (segment.length > 1) {
        map.invalidateSize();
        map.fitBounds(segment, { padding: [24, 24] });
      }
    } else if (fullBounds) {
      map.invalidateSize();
      map.fitBounds(fullBounds, { padding: [24, 24] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRange?.start.getTime(), selectedRange?.end.getTime(), resetSignal]);
  return null;
}

/** Finds the track point closest in space to a map position (drag drop, hover, click). */
function nearestPointByLatLng(points: TrackPoint[], lat: number, lng: number): TrackPoint | undefined {
  let best: TrackPoint | undefined;
  let bestDist = Infinity;
  for (const p of points) {
    if (p.lat === null || p.lon === null) continue;
    const dist = (p.lat - lat) ** 2 + (p.lon - lng) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/** Renders the polyline and handles hover-to-preview + click-to-add on the track itself. */
function TrackWithAddOnClick({
  points,
  positions,
  dimmed,
  onHoverPoint,
  onAddLapBoundary,
}: {
  points: TrackPoint[];
  positions: LatLngTuple[];
  dimmed: boolean;
  onHoverPoint: (point: TrackPoint | null) => void;
  onAddLapBoundary?: (time: Date) => void;
}) {
  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: dimmed ? '#93c5fd' : '#2563eb', weight: 3 }}
      eventHandlers={{
        mousemove: (e: LeafletMouseEvent) => {
          const nearest = nearestPointByLatLng(points, e.latlng.lat, e.latlng.lng);
          onHoverPoint(nearest ?? null);
        },
        mouseout: () => onHoverPoint(null),
        click: (e: LeafletMouseEvent) => {
          const nearest = nearestPointByLatLng(points, e.latlng.lat, e.latlng.lng);
          if (nearest) onAddLapBoundary?.(nearest.timestamp);
        },
      }}
    />
  );
}

export function MapView({
  points,
  laps,
  externalHoverTime,
  selectedRange,
  resetSignal,
  onMoveLapBoundary,
  onAddLapBoundary,
  onDeleteLapBoundary,
}: {
  points: TrackPoint[];
  laps: LapBoundary[];
  externalHoverTime?: Date | null;
  selectedRange?: { start: Date; end: Date } | null;
  resetSignal?: number;
  onMoveLapBoundary?: (boundaryIndex: number, newTime: Date) => void;
  onAddLapBoundary?: (time: Date) => void;
  onDeleteLapBoundary?: (boundaryIndex: number) => void;
}) {
  const [trackHoverPoint, setTrackHoverPoint] = useState<TrackPoint | null>(null);

  const positions = useMemo<LatLngTuple[]>(
    () => points.filter((p) => p.lat !== null && p.lon !== null).map((p) => [p.lat as number, p.lon as number]),
    [points],
  );

  const bounds = useMemo<LatLngBoundsExpression | null>(
    () => (positions.length > 0 ? positions : null),
    [positions],
  );

  const selectedPositions = useMemo<LatLngTuple[] | null>(() => {
    if (!selectedRange) return null;
    const startMs = selectedRange.start.getTime();
    const endMs = selectedRange.end.getTime();
    return points
      .filter((p) => p.lat !== null && p.lon !== null && p.timestamp.getTime() >= startMs && p.timestamp.getTime() <= endMs)
      .map((p) => [p.lat as number, p.lon as number]);
  }, [points, selectedRange]);

  // Lap 0's start is the fixed activity start, not a movable boundary — only
  // later laps' starts represent an actual boundary between two laps.
  const lapMarkers = useMemo(
    () =>
      laps
        .slice(1)
        .map((lap) => ({ lap, point: nearestPointByTime(points, lap.startTime) }))
        .filter((entry): entry is { lap: LapBoundary; point: TrackPoint } => entry.point?.lat != null && entry.point?.lon != null),
    [laps, points],
  );

  // Hovering the track itself takes priority; otherwise mirror the chart's
  // hover/pending position so the two views cross-highlight each other.
  const previewPoint = trackHoverPoint ?? nearestPointByTime(points, externalHoverTime) ?? null;

  if (positions.length === 0) {
    return <div className="map-view map-view--empty">No GPS data in this file.</div>;
  }

  return (
    <div className="map-view">
      <MapContainer center={positions[0]} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds bounds={bounds} />
        <SelectionBounds points={points} selectedRange={selectedRange} fullBounds={bounds} resetSignal={resetSignal} />
        <TrackWithAddOnClick
          points={points}
          positions={positions}
          dimmed={selectedPositions !== null}
          onHoverPoint={setTrackHoverPoint}
          onAddLapBoundary={onAddLapBoundary}
        />
        {selectedPositions && selectedPositions.length > 1 && (
          <Polyline positions={selectedPositions} pathOptions={{ color: '#f97316', weight: 4 }} interactive={false} />
        )}
        {previewPoint && previewPoint.lat !== null && previewPoint.lon !== null && (
          <Marker position={[previewPoint.lat, previewPoint.lon]} icon={previewIcon} interactive={false} />
        )}
        {lapMarkers.map(({ lap, point }) => (
          <Marker
            key={lap.index}
            position={[point.lat as number, point.lon as number]}
            icon={lapIcon}
            draggable
            eventHandlers={{
              dragend: (e: LeafletEvent) => {
                const marker = e.target as L.Marker;
                const pos = marker.getLatLng();
                const nearest = nearestPointByLatLng(points, pos.lat, pos.lng);
                if (nearest) onMoveLapBoundary?.(lap.index - 1, nearest.timestamp);
              },
              contextmenu: (e: LeafletMouseEvent) => {
                e.originalEvent.preventDefault();
                onDeleteLapBoundary?.(lap.index - 1);
              },
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
