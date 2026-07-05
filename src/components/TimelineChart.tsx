import { useMemo, useRef, useState, useEffect } from 'react';
import type { Chart as ChartJSInstance, Plugin } from 'chart.js';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Decimation,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import type { TrackPoint, LapBoundary } from '../fit/display';
import { nearestPointByTime, nearestPointByDistance } from '../fit/display';

/** A pixel x-coordinate stashed directly on the chart instance so the
 * crosshair plugin can read it without depending on the Tooltip plugin's
 * (now-disabled) active-element tracking. */
type ChartWithHoverX = ChartJSInstance & { $hoverPixelX?: number | null };

/**
 * Draws a full-height vertical line at the currently hovered x position.
 * Reads a value we stash on the chart instance ourselves (see `onHover`
 * below) during Chart.js's native draw cycle, so it doesn't need React state
 * (and the re-renders that would cause) to track the mouse, and doesn't
 * depend on the on-canvas tooltip popup being enabled.
 */
const crosshairPlugin: Plugin<'line'> = {
  id: 'hoverCrosshair',
  afterDraw(chart) {
    const x = (chart as ChartWithHoverX).$hoverPixelX;
    if (x == null) return;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
    ctx.stroke();
    ctx.restore();
  },
};

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Decimation,
  annotationPlugin,
  zoomPlugin,
  crosshairPlugin,
);

type SeriesKey = 'altitude' | 'heartRate' | 'speed' | 'power';
type XMode = 'time' | 'distance';

const SERIES_CONFIG: Array<{ key: SeriesKey; label: string; color: string }> = [
  { key: 'altitude', label: 'Altitude (m)', color: '#16a34a' },
  { key: 'heartRate', label: 'Heart rate (bpm)', color: '#dc2626' },
  { key: 'speed', label: 'Speed (m/s)', color: '#2563eb' },
  { key: 'power', label: 'Power (W)', color: '#7c3aed' },
];

// A click that follows a drag-to-zoom fires within this window; suppress it
// so releasing a zoom-drag doesn't also place a pending lap marker.
const ZOOM_CLICK_SUPPRESS_MS = 300;

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDistanceKm(km: number): string {
  return `${km.toFixed(2)} km`;
}

function formatX(value: number, xMode: XMode): string {
  return xMode === 'time' ? formatElapsed(value) : formatDistanceKm(value);
}

/** The point's position along the current x-axis metric, or `null` if that metric isn't available for it. */
function xOf(p: TrackPoint, xMode: XMode, startMs: number): number | null {
  if (xMode === 'time') return (p.timestamp.getTime() - startMs) / 1000;
  return p.distance !== null ? p.distance / 1000 : null;
}

export function TimelineChart({
  points,
  laps,
  onAddLapBoundary,
  onHoverChange,
  onRangeChange,
  onResetZoom,
}: {
  points: TrackPoint[];
  laps: LapBoundary[];
  onAddLapBoundary?: (time: Date) => void;
  onHoverChange?: (time: Date | null) => void;
  onRangeChange?: (range: { start: Date; end: Date } | null) => void;
  /** Called on "Reset zoom", in addition to `onRangeChange(null)` — lets a
   * parent force the map to refit to the whole route even when there was no
   * chart-driven selection to clear (e.g. the user zoomed the map directly). */
  onResetZoom?: () => void;
}) {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    altitude: true,
    heartRate: true,
    speed: true,
    power: true,
  });
  const [xMode, setXMode] = useState<XMode>('time');
  const [pendingX, setPendingX] = useState<number | null>(null);
  // Explicit, React-owned zoom window (in the current x-mode's units). We pin
  // scales.x.min/max to this ourselves rather than relying on
  // chartjs-plugin-zoom's internal post-update state: any options rebuild
  // (e.g. placing a pending marker changes `annotations`) makes
  // react-chartjs-2 call chart.update(), and without an explicit min/max the
  // scale re-auto-ranges from data, undoing the zoom. Owning it ourselves
  // means every options rebuild re-asserts it.
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const chartRef = useRef<ChartJSInstance<'line'> | null>(null);
  const lastZoomTimeRef = useRef(0);

  const startMs = points[0]?.timestamp.getTime() ?? 0;
  const hasDistance = useMemo(() => points.some((p) => p.distance !== null), [points]);

  // Switching x-axis metrics changes what these numbers mean, so any
  // in-progress chart-local selection no longer makes sense — clear it. The
  // map's highlighted range (in real dates, owned by the parent) is unaffected.
  function changeXMode(mode: XMode) {
    setXMode(mode);
    setPendingX(null);
    setZoomRange(null);
  }

  function dateAtX(xValue: number): Date | null {
    if (xMode === 'time') return new Date(startMs + xValue * 1000);
    return nearestPointByDistance(points, xValue * 1000)?.timestamp ?? null;
  }

  const availableSeries = useMemo(
    () => SERIES_CONFIG.filter((cfg) => points.some((p) => p[cfg.key] !== null)),
    [points],
  );

  // Decimation (used for long recordings) requires parsing disabled and each
  // dataset's data as explicit {x, y} points rather than a shared labels array.
  const series = useMemo(() => {
    const result: Record<SeriesKey, Array<{ x: number; y: number }>> = {
      altitude: [],
      heartRate: [],
      speed: [],
      power: [],
    };
    for (const p of points) {
      const x = xOf(p, xMode, startMs);
      if (x === null) continue;
      if (p.altitude !== null) result.altitude.push({ x, y: p.altitude });
      if (p.heartRate !== null) result.heartRate.push({ x, y: p.heartRate });
      if (p.speed !== null) result.speed.push({ x, y: p.speed });
      if (p.power !== null) result.power.push({ x, y: p.power });
    }
    return result;
  }, [points, xMode, startMs]);

  useEffect(() => {
    if (pendingX === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPendingX(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pendingX]);

  const annotations = useMemo(() => {
    const result: Record<string, AnnotationOptions<'line'>> = {};
    for (const lap of laps) {
      if (!lap.startTime) continue;
      const point = nearestPointByTime(points, lap.startTime);
      if (!point) continue;
      const x = xOf(point, xMode, startMs);
      if (x === null) continue;
      result[`lap-${lap.index}`] = {
        type: 'line',
        xMin: x,
        xMax: x,
        borderColor: '#f97316',
        borderWidth: 1,
        borderDash: [4, 4],
      };
    }
    if (pendingX !== null) {
      result.pending = {
        type: 'line',
        xMin: pendingX,
        xMax: pendingX,
        borderColor: '#2563eb',
        borderWidth: 2,
      };
    }
    return result;
  }, [laps, points, xMode, startMs, pendingX]);

  // Memoized so identity is stable across hover-only re-renders (onHoverChange
  // fires on every pointer move) — otherwise react-chartjs-2 feeds Chart.js a
  // "new" data/options object on every mouse tick, and updating the chart
  // with those resets the zoom plugin's applied scale range almost as soon as
  // it's set.
  const datasets = useMemo(
    () =>
      availableSeries
        .filter((cfg) => visible[cfg.key])
        .map((cfg) => ({
          label: cfg.label,
          data: series[cfg.key],
          borderColor: cfg.color,
          yAxisID: cfg.key,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: cfg.color,
          borderWidth: 1.5,
        })),
    [availableSeries, series, visible],
  );

  const data = useMemo(() => ({ datasets }), [datasets]);

  const scaleAxes = useMemo(() => {
    const result: Record<string, { type: 'linear'; position: 'left' | 'right'; display: boolean }> = {};
    availableSeries.forEach((cfg, i) => {
      result[cfg.key] = { type: 'linear', position: i === 0 ? 'left' : 'right', display: i === 0 && visible[cfg.key] };
    });
    return result;
  }, [availableSeries, visible]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      parsing: false as const,
      normalized: true,
      animation: false as const,
      // Trigger hover/tooltip/crosshair from x-position alone — the mouse
      // doesn't need to land exactly on a (near-invisible, pointRadius: 0) line.
      interaction: { mode: 'index' as const, intersect: false, axis: 'x' as const },
      onHover: (event: { x: number | null }, _elements: unknown, chart: ChartJSInstance) => {
        if (event.x == null) return;
        (chart as ChartWithHoverX).$hoverPixelX = event.x;
        const xValue = chart.scales.x.getValueForPixel(event.x);
        if (xValue == null) return;
        const date = dateAtX(xValue);
        if (date) onHoverChange?.(date);
      },
      onClick: (event: { x: number | null }, _elements: unknown, chart: ChartJSInstance) => {
        if (!onAddLapBoundary || event.x == null) return;
        if (Date.now() - lastZoomTimeRef.current < ZOOM_CLICK_SUPPRESS_MS) return;
        const xValue = chart.scales.x.getValueForPixel(event.x);
        if (xValue == null) return;
        setPendingX(xValue);
      },
      plugins: {
        legend: { display: false },
        // The on-canvas popup was distracting during hover; we show the same
        // information via the crosshair line and the highlighted lap-list row.
        tooltip: { enabled: false },
        decimation: { enabled: true, algorithm: 'lttb' as const, samples: 500 },
        annotation: { annotations },
        zoom: {
          zoom: {
            drag: { enabled: true, backgroundColor: 'rgba(37,99,235,0.15)', borderColor: '#2563eb', borderWidth: 1 },
            mode: 'x' as const,
            onZoomComplete: ({ chart }: { chart: ChartJSInstance }) => {
              lastZoomTimeRef.current = Date.now();
              const { min, max } = chart.scales.x;
              setZoomRange({ min, max });
              const start = dateAtX(min);
              const end = dateAtX(max);
              if (start && end) onRangeChange?.({ start, end });
            },
          },
          pan: { enabled: false },
        },
      },
      scales: {
        x: {
          type: 'linear' as const,
          min: zoomRange?.min,
          max: zoomRange?.max,
          ticks: { callback: (value: string | number) => formatX(Number(value), xMode) },
        },
        ...scaleAxes,
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [annotations, scaleAxes, onHoverChange, onAddLapBoundary, onRangeChange, startMs, zoomRange, xMode],
  );

  if (points.length === 0) {
    return <div className="timeline-chart timeline-chart--empty">No record data in this file.</div>;
  }

  function resetZoom() {
    chartRef.current?.resetZoom();
    setZoomRange(null);
    onRangeChange?.(null);
    onResetZoom?.();
  }

  return (
    <div className="timeline-chart">
      <div className="chart-controls">
        {hasDistance && (
          <div className="x-mode-toggle">
            <button type="button" className={xMode === 'time' ? 'active' : ''} onClick={() => changeXMode('time')}>
              Time
            </button>
            <button
              type="button"
              className={xMode === 'distance' ? 'active' : ''}
              onClick={() => changeXMode('distance')}
            >
              Distance
            </button>
          </div>
        )}
        {onAddLapBoundary && (
          <span className="series-toggles-hint">Click to place a lap marker, drag to zoom</span>
        )}
        <button type="button" className="chart-reset-zoom" onClick={resetZoom}>
          Reset zoom
        </button>
      </div>
      <div className="series-toggles">
        {availableSeries.map((cfg) => (
          <label key={cfg.key}>
            <input
              type="checkbox"
              checked={visible[cfg.key]}
              onChange={() => setVisible((v) => ({ ...v, [cfg.key]: !v[cfg.key] }))}
            />
            {cfg.label}
          </label>
        ))}
      </div>
      {pendingX !== null && (
        <div className="pending-lap-bar">
          <span>New lap marker at {formatX(pendingX, xMode)} — click elsewhere to move it.</span>
          <button
            type="button"
            onClick={() => {
              const date = dateAtX(pendingX);
              if (date) onAddLapBoundary?.(date);
              setPendingX(null);
            }}
          >
            Confirm
          </button>
          <button type="button" onClick={() => setPendingX(null)}>
            Cancel
          </button>
        </div>
      )}
      <div
        className="timeline-chart-canvas"
        onMouseLeave={() => {
          onHoverChange?.(null);
          const chart = chartRef.current as ChartWithHoverX | null;
          if (chart) {
            chart.$hoverPixelX = null;
            chart.draw();
          }
        }}
      >
        <Line ref={chartRef} data={data} options={options} />
      </div>
    </div>
  );
}
