import type { LapBoundary } from '../fit/display';

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDistance(meters: number | null): string {
  if (meters === null) return '—';
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatTime(time: Date | null): string {
  if (!time) return '—';
  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatNumber(value: number | null, unit: string): string {
  if (value === null) return '—';
  return `${Math.round(value)} ${unit}`;
}

export function LapList({
  laps,
  activeLapIndex,
  onDeleteLap,
}: {
  laps: LapBoundary[];
  activeLapIndex?: number | null;
  onDeleteLap: (lapIndex: number) => void;
}) {
  if (laps.length === 0) return null;

  const hasHeartRate = laps.some((lap) => lap.avgHeartRate !== null);
  const hasPower = laps.some((lap) => lap.avgPower !== null);

  return (
    <table className="lap-list">
      <thead>
        <tr>
          <th>Lap</th>
          <th>Start</th>
          <th>Duration</th>
          <th>Distance</th>
          {hasHeartRate && <th>Avg HR</th>}
          {hasPower && <th>Avg Power</th>}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {laps.map((lap) => (
          <tr key={lap.index} className={lap.index === activeLapIndex ? 'lap-list-row--active' : undefined}>
            <td>{lap.index + 1}</td>
            <td>{formatTime(lap.startTime)}</td>
            <td>{formatDuration(lap.durationSeconds)}</td>
            <td>{formatDistance(lap.distanceMeters)}</td>
            {hasHeartRate && <td>{formatNumber(lap.avgHeartRate, 'bpm')}</td>}
            {hasPower && <td>{formatNumber(lap.avgPower, 'W')}</td>}
            <td>
              <button type="button" disabled={laps.length <= 1} onClick={() => onDeleteLap(lap.index)}>
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
