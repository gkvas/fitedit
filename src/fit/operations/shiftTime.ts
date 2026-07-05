import type { FitModel, FitMesg } from '../model';

// Fields of profile type `localDateTime` (same FIT epoch as `dateTime`, but
// the decoder leaves them as raw seconds instead of converting to `Date` —
// see decode.ts / utils.js's `dateTime`-only check) that still need shifting
// alongside every `Date`-valued field.
const LOCAL_DATE_TIME_FIELDS = new Set(['localTimestamp', 'scheduledTime']);

/**
 * Shifts every timestamp in the file by `deltaSeconds`, preserving all
 * relative timing (lap boundaries, elapsed/timer durations, record spacing)
 * exactly.
 *
 * Garmin Connect's duplicate-activity check is keyed on device serial number
 * + start time, and that fingerprint is known to survive deleting the
 * original activity — so re-uploading an edited copy of a deleted activity
 * gets rejected as a duplicate even though nothing about the file itself is
 * wrong. A uniform time shift changes that fingerprint without altering any
 * recorded data.
 */
export function shiftTime(model: FitModel, deltaSeconds: number): FitModel {
  const delta = Math.round(deltaSeconds);
  const deltaMs = delta * 1000;

  const entries = model.entries.map((entry) => {
    const mesg: FitMesg = { ...entry.mesg };
    for (const [key, value] of Object.entries(mesg)) {
      if (value instanceof Date) {
        mesg[key] = new Date(value.getTime() + deltaMs);
      } else if (LOCAL_DATE_TIME_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
        mesg[key] = value + delta;
      }
    }
    return { ...entry, mesg };
  });

  return { entries };
}
