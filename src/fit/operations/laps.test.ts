import { describe, expect, it } from 'vitest';
import { Profile } from '@garmin/fitsdk';
import { moveLapBoundary, addLapBoundary, deleteLap } from './laps';
import type { FitModel } from '../model';

const T0 = new Date('2026-07-01T10:00:00Z');

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

/** A 100-second, two-lap synthetic activity: lap 0 = [0,50], lap 1 = [50,100]. One record per second. */
function twoLapModel(): FitModel {
  const entries: FitModel['entries'] = [
    { mesgNum: Profile.MesgNum.FILE_ID, mesg: { type: 'activity', manufacturer: 'garmin' } },
  ];
  for (let s = 0; s <= 100; s++) {
    entries.push({
      mesgNum: Profile.MesgNum.RECORD,
      mesg: {
        timestamp: at(s),
        distance: s * 3,
        heartRate: 100 + (s % 20),
        altitude: 100 + s * 0.1,
      },
    });
  }
  entries.push({
    mesgNum: Profile.MesgNum.LAP,
    mesg: { messageIndex: 0, startTime: at(0), timestamp: at(50), sport: 'cycling', totalDistance: 150 },
  });
  entries.push({
    mesgNum: Profile.MesgNum.LAP,
    mesg: { messageIndex: 1, startTime: at(50), timestamp: at(100), sport: 'cycling', totalDistance: 150 },
  });
  entries.push({
    mesgNum: Profile.MesgNum.SESSION,
    mesg: { messageIndex: 0, startTime: at(0), timestamp: at(100), numLaps: 2 },
  });
  return { entries };
}

function laps(model: FitModel) {
  return model.entries.filter((e) => e.mesgNum === Profile.MesgNum.LAP).map((e) => e.mesg);
}

function sessionOf(model: FitModel) {
  return model.entries.find((e) => e.mesgNum === Profile.MesgNum.SESSION)!.mesg;
}

describe('moveLapBoundary', () => {
  it('shifts the shared boundary and recomputes both adjacent laps', () => {
    const result = moveLapBoundary(twoLapModel(), 0, at(40));
    const [lap0, lap1] = laps(result);

    expect(lap0.timestamp).toEqual(at(40));
    expect(lap1.startTime).toEqual(at(40));
    expect(lap0.totalElapsedTime).toBe(40);
    expect(lap1.totalElapsedTime).toBe(60);
    // distance: 40 records worth of 3 units/s from s=0 to s=40 -> 40*3 - 0*3 = 120
    expect(lap0.totalDistance).toBe(120);
    expect(lap1.totalDistance).toBe(180);
  });

  it('renumbers messageIndex sequentially and keeps lap count', () => {
    const result = moveLapBoundary(twoLapModel(), 0, at(40));
    const result_laps = laps(result);
    expect(result_laps.map((l) => l.messageIndex)).toEqual([0, 1]);
    expect(sessionOf(result).numLaps).toBe(2);
  });

  it('is a no-op when the new time is outside the adjacent laps range', () => {
    const model = twoLapModel();
    expect(moveLapBoundary(model, 0, at(0))).toBe(model);
    expect(moveLapBoundary(model, 0, at(100))).toBe(model);
  });

  it('is a no-op for an out-of-range boundary index', () => {
    const model = twoLapModel();
    expect(moveLapBoundary(model, 5, at(40))).toBe(model);
    expect(moveLapBoundary(model, -1, at(40))).toBe(model);
    // Only one boundary exists between 2 laps (index 0); index 1 is out of range.
    expect(moveLapBoundary(model, 1, at(40))).toBe(model);
  });
});

describe('addLapBoundary', () => {
  it('splits the containing lap into two and bumps the lap count', () => {
    const result = addLapBoundary(twoLapModel(), at(20));
    const result_laps = laps(result);
    expect(result_laps).toHaveLength(3);
    expect(result_laps[0].startTime).toEqual(at(0));
    expect(result_laps[0].timestamp).toEqual(at(20));
    expect(result_laps[1].startTime).toEqual(at(20));
    expect(result_laps[1].timestamp).toEqual(at(50));
    expect(result_laps[2].startTime).toEqual(at(50));
    expect(result_laps.map((l) => l.messageIndex)).toEqual([0, 1, 2]);
    expect(sessionOf(result).numLaps).toBe(3);
  });

  it('is a no-op when the time lands exactly on an existing boundary', () => {
    const model = twoLapModel();
    expect(addLapBoundary(model, at(50))).toBe(model);
    expect(addLapBoundary(model, at(0))).toBe(model);
    expect(addLapBoundary(model, at(100))).toBe(model);
  });
});

describe('deleteLap', () => {
  it('merges a non-last lap with the following lap', () => {
    const result = deleteLap(twoLapModel(), 0);
    const result_laps = laps(result);
    expect(result_laps).toHaveLength(1);
    expect(result_laps[0].startTime).toEqual(at(0));
    expect(result_laps[0].timestamp).toEqual(at(100));
    expect(sessionOf(result).numLaps).toBe(1);
  });

  it('merges the last lap with the previous one', () => {
    const result = deleteLap(twoLapModel(), 1);
    const result_laps = laps(result);
    expect(result_laps).toHaveLength(1);
    expect(result_laps[0].startTime).toEqual(at(0));
    expect(result_laps[0].timestamp).toEqual(at(100));
  });

  it('refuses to delete the only remaining lap', () => {
    const oneLap = deleteLap(twoLapModel(), 0);
    expect(deleteLap(oneLap, 0)).toBe(oneLap);
  });

  it('is a no-op for an out-of-range index', () => {
    const model = twoLapModel();
    expect(deleteLap(model, 5)).toBe(model);
    expect(deleteLap(model, -1)).toBe(model);
  });
});

describe('records stay grouped with the lap message that follows them', () => {
  it('places each lap message right after its last record', () => {
    const result = moveLapBoundary(twoLapModel(), 0, at(40));
    const idx40 = result.entries.findIndex(
      (e) => e.mesgNum === Profile.MesgNum.RECORD && (e.mesg.timestamp as Date).getTime() === at(40).getTime(),
    );
    expect(result.entries[idx40 + 1].mesgNum).toBe(Profile.MesgNum.LAP);
  });
});
