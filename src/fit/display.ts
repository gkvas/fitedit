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
  normalizedPower: number | null;
}

const NP_WINDOW_SECONDS = 30;
// Records more than this far apart are treated as a recording pause: the
// gap is zero-filled instead of carrying the last power reading forward,
// which would otherwise inflate NP across auto-pauses.
const NP_GAP_FORWARD_FILL_LIMIT_SECONDS = 3;

interface PowerSample {
  timeMs: number;
  power: number;
}

/**
 * Normalized power over [startMs, endMs): resample record power to 1 Hz,
 * take a 30 s rolling average, then the fourth root of the mean of its
 * fourth powers. Returns null when there is less than one full window of
 * data. `samples` must be sorted by time.
 */
function computeNormalizedPower(samples: PowerSample[], startMs: number, endMs: number): number | null {
  const inLap = samples.filter((s) => s.timeMs >= startMs && s.timeMs < endMs);
  if (inLap.length === 0) return null;

  const perSecond: number[] = [];
  for (let i = 0; i < inLap.length; i++) {
    perSecond.push(inLap[i].power);
    if (i + 1 < inLap.length) {
      const gapSeconds = Math.round((inLap[i + 1].timeMs - inLap[i].timeMs) / 1000) - 1;
      for (let g = 0; g < gapSeconds; g++) {
        perSecond.push(g < NP_GAP_FORWARD_FILL_LIMIT_SECONDS ? inLap[i].power : 0);
      }
    }
  }
  if (perSecond.length < NP_WINDOW_SECONDS) return null;

  let windowSum = 0;
  let fourthPowerSum = 0;
  let windowCount = 0;
  for (let i = 0; i < perSecond.length; i++) {
    windowSum += perSecond[i];
    if (i >= NP_WINDOW_SECONDS) windowSum -= perSecond[i - NP_WINDOW_SECONDS];
    if (i >= NP_WINDOW_SECONDS - 1) {
      fourthPowerSum += (windowSum / NP_WINDOW_SECONDS) ** 4;
      windowCount++;
    }
  }
  return (fourthPowerSum / windowCount) ** 0.25;
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

  const powerSamples: PowerSample[] = mesgsOf<RecordMesg>(model, Profile.MesgNum.RECORD)
    .filter((r) => r.timestamp instanceof Date && typeof r.power === 'number')
    .map((r) => ({ timeMs: (r.timestamp as Date).getTime(), power: r.power as number }))
    .sort((a, b) => a.timeMs - b.timeMs);

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
      normalizedPower:
        typeof lap.normalizedPower === 'number'
          ? lap.normalizedPower
          : startTime && endTime
            ? computeNormalizedPower(powerSamples, startTime.getTime(), endTime.getTime())
            : null,
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
