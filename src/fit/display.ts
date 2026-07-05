import { Profile } from '@garmin/fitsdk';
import type { RecordMesg, LapMesg, FileIdMesg } from '@garmin/fitsdk';
import { mesgsOf, type FitModel } from './model';

const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31;

/** Converts a FIT semicircle coordinate to degrees; `undefined`/`null` pass through as `null`. */
export function semicirclesToDegrees(value: number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  return value * SEMICIRCLE_TO_DEGREES;
}

export interface TrackPoint {
  timestamp: Date;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  heartRate: number | null;
  speed: number | null;
  distance: number | null;
  power: number | null;
}

function firstDefined(...values: Array<number | undefined>): number | null {
  for (const v of values) {
    if (v !== undefined) return v;
  }
  return null;
}

/**
 * The SDK types `dateTime` fields as `number | Date | "min"` to cover
 * raw-decode mode and a "system time" sentinel, but we always decode with
 * date conversion on, so this is always a Date at runtime; normalize the
 * type accordingly.
 */
function asDate(value: number | Date | string | undefined): Date | null {
  return value instanceof Date ? value : null;
}

/** Extracts display-friendly track points (degrees, meters, m/s) from a model's record messages. */
export function trackPointsOf(model: FitModel): TrackPoint[] {
  const records = mesgsOf<RecordMesg>(model, Profile.MesgNum.RECORD);
  return records
    .filter((r) => r.timestamp instanceof Date)
    .map((r) => ({
      timestamp: r.timestamp as Date,
      lat: semicirclesToDegrees(r.positionLat),
      lon: semicirclesToDegrees(r.positionLong),
      altitude: firstDefined(r.enhancedAltitude, r.altitude),
      heartRate: firstDefined(r.heartRate),
      speed: firstDefined(r.enhancedSpeed, r.speed),
      distance: firstDefined(r.distance),
      power: firstDefined(r.power),
    }));
}

/** Finds the track point closest in time to a given timestamp. */
export function nearestPointByTime(points: TrackPoint[], time: Date | null | undefined): TrackPoint | undefined {
  if (!time) return undefined;
  let best: TrackPoint | undefined;
  let bestDiff = Infinity;
  for (const p of points) {
    const diff = Math.abs(p.timestamp.getTime() - time.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best;
}

/** Finds the track point closest to a given cumulative distance (meters). */
export function nearestPointByDistance(points: TrackPoint[], distanceMeters: number): TrackPoint | undefined {
  let best: TrackPoint | undefined;
  let bestDiff = Infinity;
  for (const p of points) {
    if (p.distance === null) continue;
    const diff = Math.abs(p.distance - distanceMeters);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best;
}

export interface LapBoundary {
  index: number;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgHeartRate: number | null;
  avgPower: number | null;
}

/**
 * Extracts lap summaries (in start-time order) from a model's lap messages.
 *
 * `endTime` is derived from the next lap's start (or the lap's own
 * `totalElapsedTime` for the last lap) rather than trusted from the lap
 * message's own `timestamp` field — found against a real Garmin Edge file
 * where every lap's `timestamp` was stuck at the activity's start time. See
 * the same fix in operations/laps.ts.
 */
export function lapBoundariesOf(model: FitModel): LapBoundary[] {
  const laps = mesgsOf<LapMesg>(model, Profile.MesgNum.LAP)
    .filter((l) => asDate(l.startTime))
    .sort((a, b) => (asDate(a.startTime) as Date).getTime() - (asDate(b.startTime) as Date).getTime());

  return laps.map((lap, index) => {
    const startTime = asDate(lap.startTime);
    const next = laps[index + 1];
    const nextStart = next ? asDate(next.startTime) : null;
    const endTime =
      nextStart ?? (startTime && typeof lap.totalElapsedTime === 'number'
        ? new Date(startTime.getTime() + lap.totalElapsedTime * 1000)
        : null);

    return {
      index,
      startTime,
      endTime,
      durationSeconds: typeof lap.totalElapsedTime === 'number' ? lap.totalElapsedTime : null,
      distanceMeters: typeof lap.totalDistance === 'number' ? lap.totalDistance : null,
      avgHeartRate: typeof lap.avgHeartRate === 'number' ? lap.avgHeartRate : null,
      avgPower: typeof lap.avgPower === 'number' ? lap.avgPower : null,
    };
  });
}

export interface DeviceIdentity {
  manufacturer: string | null;
  productLabel: string | null;
}

/** Reads the file's recording-device identity from its file_id message. */
export function deviceIdentityOf(model: FitModel): DeviceIdentity {
  const fileId = mesgsOf<FileIdMesg>(model, Profile.MesgNum.FILE_ID)[0];
  if (!fileId) return { manufacturer: null, productLabel: null };

  const manufacturer = typeof fileId.manufacturer === 'string' ? fileId.manufacturer : null;
  const productLabel =
    typeof fileId.garminProduct === 'string'
      ? fileId.garminProduct
      : fileId.product !== undefined
        ? String(fileId.product)
        : null;

  return { manufacturer, productLabel };
}
