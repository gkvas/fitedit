import { Profile } from '@garmin/fitsdk';
import type { RecordMesg } from '@garmin/fitsdk';
import { mesgsOf, type FitModel, type FitMesg, type FitMesgEntry } from '../model';

function asDate(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

function sortedRecords(model: FitModel): RecordMesg[] {
  return mesgsOf<RecordMesg>(model, Profile.MesgNum.RECORD)
    .filter((r) => r.timestamp instanceof Date)
    .sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime());
}

function recordsInRange(records: RecordMesg[], start: Date, end: Date): RecordMesg[] {
  return records.filter((r) => {
    const t = (r.timestamp as Date).getTime();
    return t >= start.getTime() && t <= end.getTime();
  });
}

interface LapRange {
  mesg: FitMesg;
  start: Date;
  end: Date;
}

/**
 * Laps sorted by start time, with a robustly-derived end time for each.
 *
 * We deliberately do NOT trust a lap message's own `timestamp` field as "end
 * of lap": found against a real Garmin Edge file where every lap's
 * `timestamp` was stuck at the activity's start time (only `startTime` was
 * populated correctly). Instead, a lap's end is the next lap's start; for
 * the last lap, it's the last record's timestamp (falling back to
 * `startTime + totalElapsedTime` if there are no records).
 */
function lapRanges(model: FitModel): LapRange[] {
  const laps = mesgsOf<FitMesg>(model, Profile.MesgNum.LAP)
    .filter((l) => asDate(l.startTime))
    .sort((a, b) => (asDate(a.startTime) as Date).getTime() - (asDate(b.startTime) as Date).getTime());

  const records = sortedRecords(model);
  const lastRecordTime = records.length > 0 ? (records[records.length - 1].timestamp as Date) : null;

  return laps.map((mesg, i) => {
    const start = asDate(mesg.startTime) as Date;
    const next = laps[i + 1];
    if (next) {
      return { mesg, start, end: asDate(next.startTime) as Date };
    }
    if (lastRecordTime && lastRecordTime.getTime() > start.getTime()) {
      return { mesg, start, end: lastRecordTime };
    }
    const totalElapsedTime = typeof mesg.totalElapsedTime === 'number' ? mesg.totalElapsedTime : 0;
    return { mesg, start, end: new Date(start.getTime() + totalElapsedTime * 1000) };
  });
}

function numbers(values: Array<number | undefined>): number[] {
  return values.filter((v): v is number => v !== undefined && !Number.isNaN(v));
}

function avg(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Recomputes a lap message's core stats from the records within [start, end].
 * Fields we can't honestly recompute from record data (running dynamics,
 * grit/flow, training load, ...) are intentionally dropped rather than left
 * stale — see the "change device" scope note in operations/device.ts for the
 * same reasoning applied to a different field set.
 */
function buildLap(records: RecordMesg[], start: Date, end: Date, template: FitMesg): FitMesg {
  const hr = numbers(records.map((r) => r.heartRate));
  const cadence = numbers(records.map((r) => r.cadence));
  const power = numbers(records.map((r) => r.power));
  const speed = numbers(records.map((r) => r.enhancedSpeed ?? r.speed));
  const altitude = numbers(records.map((r) => r.enhancedAltitude ?? r.altitude));
  const distance = numbers(records.map((r) => r.distance));

  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < altitude.length; i++) {
    const delta = altitude[i] - altitude[i - 1];
    if (delta > 0) ascent += delta;
    else descent -= delta;
  }

  const first = records[0];
  const last = records[records.length - 1];
  const totalElapsedTime = (end.getTime() - start.getTime()) / 1000;

  const lap: FitMesg = {
    event: 'lap',
    eventType: 'stop',
    startTime: start,
    timestamp: end,
    totalElapsedTime,
    totalTimerTime: totalElapsedTime,
    lapTrigger: template.lapTrigger ?? 'manual',
  };
  if (template.sport !== undefined) lap.sport = template.sport;
  if (template.subSport !== undefined) lap.subSport = template.subSport;
  if (distance.length >= 2) lap.totalDistance = distance[distance.length - 1] - distance[0];
  if (hr.length > 0) {
    lap.avgHeartRate = Math.round(avg(hr)!);
    lap.maxHeartRate = Math.max(...hr);
    lap.minHeartRate = Math.min(...hr);
  }
  if (cadence.length > 0) {
    lap.avgCadence = Math.round(avg(cadence)!);
    lap.maxCadence = Math.max(...cadence);
  }
  if (power.length > 0) {
    lap.avgPower = Math.round(avg(power)!);
    lap.maxPower = Math.max(...power);
  }
  if (speed.length > 0) {
    lap.avgSpeed = avg(speed);
    lap.maxSpeed = Math.max(...speed);
  }
  if (altitude.length > 1) {
    lap.totalAscent = Math.round(ascent);
    lap.totalDescent = Math.round(descent);
  }
  if (first?.positionLat !== undefined) lap.startPositionLat = first.positionLat;
  if (first?.positionLong !== undefined) lap.startPositionLong = first.positionLong;
  if (last?.positionLat !== undefined) lap.endPositionLat = last.positionLat;
  if (last?.positionLong !== undefined) lap.endPositionLong = last.positionLong;

  return lap;
}

function finalizeLaps(laps: FitMesg[]): FitMesg[] {
  return laps.map((lap, i) => ({ ...lap, messageIndex: i }));
}

/**
 * Rebuilds a model's entry list with a new set of lap messages (each built
 * by `buildLap`, so its own `timestamp` is a correct end time — unlike the
 * possibly-quirky `timestamp` on laps read from the original file). Each lap
 * is reinserted right after the last record at or before its end time, so
 * records stay grouped with the lap message that follows them — the
 * convention most FIT readers rely on for lap/record grouping. Also patches
 * any session message's `numLaps` to match, since add/delete change the lap
 * count.
 */
function rebuildWithLaps(model: FitModel, newLaps: FitMesg[]): FitModel {
  const withoutLaps = model.entries.filter((e) => e.mesgNum !== Profile.MesgNum.LAP);
  const sorted = [...newLaps].sort((a, b) => (a.timestamp as Date).getTime() - (b.timestamp as Date).getTime());

  const result: FitMesgEntry[] = [];
  let lapIdx = 0;
  for (const entry of withoutLaps) {
    if (entry.mesgNum === Profile.MesgNum.SESSION) {
      result.push({ ...entry, mesg: { ...entry.mesg, numLaps: sorted.length } });
      continue;
    }
    result.push(entry);
    if (entry.mesgNum === Profile.MesgNum.RECORD) {
      const t = asDate(entry.mesg.timestamp);
      while (lapIdx < sorted.length && t && t.getTime() >= (sorted[lapIdx].timestamp as Date).getTime()) {
        result.push({ mesgNum: Profile.MesgNum.LAP, mesg: sorted[lapIdx] });
        lapIdx++;
      }
    }
  }
  while (lapIdx < sorted.length) {
    result.push({ mesgNum: Profile.MesgNum.LAP, mesg: sorted[lapIdx] });
    lapIdx++;
  }

  return { entries: result };
}

/**
 * Moves the boundary between lap `boundaryIndex` and lap `boundaryIndex + 1`
 * to `newTime`, recomputing both adjacent laps. No-op if the boundary index
 * or time is out of range.
 */
export function moveLapBoundary(model: FitModel, boundaryIndex: number, newTime: Date): FitModel {
  const laps = lapRanges(model);
  if (boundaryIndex < 0 || boundaryIndex >= laps.length - 1) return model;

  const before = laps[boundaryIndex];
  const after = laps[boundaryIndex + 1];
  if (newTime.getTime() <= before.start.getTime() || newTime.getTime() >= after.end.getTime()) return model;

  const records = sortedRecords(model);
  const newBefore = buildLap(recordsInRange(records, before.start, newTime), before.start, newTime, before.mesg);
  const newAfter = buildLap(recordsInRange(records, newTime, after.end), newTime, after.end, after.mesg);

  const newLaps = laps.map((lap, i) => {
    if (i === boundaryIndex) return newBefore;
    if (i === boundaryIndex + 1) return newAfter;
    return lap.mesg;
  });

  return rebuildWithLaps(model, finalizeLaps(newLaps));
}

/** Splits the lap containing `time` into two laps at that point. No-op if `time` isn't strictly inside a lap. */
export function addLapBoundary(model: FitModel, time: Date): FitModel {
  const laps = lapRanges(model);
  const containingIndex = laps.findIndex(
    (lap) => time.getTime() > lap.start.getTime() && time.getTime() < lap.end.getTime(),
  );
  if (containingIndex === -1) return model;

  const lap = laps[containingIndex];
  const records = sortedRecords(model);
  const first = buildLap(recordsInRange(records, lap.start, time), lap.start, time, lap.mesg);
  const second = buildLap(recordsInRange(records, time, lap.end), time, lap.end, lap.mesg);

  const newLaps = [
    ...laps.slice(0, containingIndex).map((l) => l.mesg),
    first,
    second,
    ...laps.slice(containingIndex + 1).map((l) => l.mesg),
  ];
  return rebuildWithLaps(model, finalizeLaps(newLaps));
}

/**
 * Deletes lap `lapIndex`, merging its records into the following lap (or the
 * previous one, if it's the last lap). No-op if it's the only lap, or the
 * index is out of range.
 */
export function deleteLap(model: FitModel, lapIndex: number): FitModel {
  const laps = lapRanges(model);
  if (laps.length <= 1 || lapIndex < 0 || lapIndex >= laps.length) return model;

  const mergeWithNext = lapIndex < laps.length - 1;
  const otherIndex = mergeWithNext ? lapIndex + 1 : lapIndex - 1;
  const start = (mergeWithNext ? laps[lapIndex] : laps[otherIndex]).start;
  const end = (mergeWithNext ? laps[otherIndex] : laps[lapIndex]).end;

  const records = sortedRecords(model);
  const merged = buildLap(recordsInRange(records, start, end), start, end, laps[otherIndex].mesg);

  const newLaps: FitMesg[] = [];
  for (let i = 0; i < laps.length; i++) {
    if (i === lapIndex) continue;
    newLaps.push(i === otherIndex ? merged : laps[i].mesg);
  }

  return rebuildWithLaps(model, finalizeLaps(newLaps));
}
