import { describe, expect, it } from 'vitest';
import { Profile } from '@garmin/fitsdk';
import { lapBoundariesOf, semicirclesToDegrees, trackPointsOf } from './display';
import type { FitModel } from './model';

describe('semicirclesToDegrees', () => {
  it('converts a known semicircle value to degrees', () => {
    // 473000000 semicircles ~= 39.6459... degrees
    expect(semicirclesToDegrees(473000000)).toBeCloseTo(39.6464, 3);
  });

  it('passes through null/undefined', () => {
    expect(semicirclesToDegrees(null)).toBeNull();
    expect(semicirclesToDegrees(undefined)).toBeNull();
  });
});

describe('trackPointsOf', () => {
  it('prefers enhanced fields and drops records with no timestamp', () => {
    const model: FitModel = {
      entries: [
        {
          mesgNum: Profile.MesgNum.RECORD,
          mesg: {
            timestamp: new Date('2026-07-01T10:00:00Z'),
            positionLat: 473000000,
            positionLong: 85000000,
            altitude: 100,
            enhancedAltitude: 100.5,
            speed: 5,
            enhancedSpeed: 5.2,
            heartRate: 130,
            distance: 10,
          },
        },
        {
          // No timestamp — should be skipped.
          mesgNum: Profile.MesgNum.RECORD,
          mesg: { heartRate: 999 },
        },
      ],
    };

    const points = trackPointsOf(model);
    expect(points).toHaveLength(1);
    expect(points[0].altitude).toBe(100.5);
    expect(points[0].speed).toBe(5.2);
    expect(points[0].heartRate).toBe(130);
    expect(points[0].lat).toBeCloseTo(39.6464, 3);
  });
});

describe('lapBoundariesOf', () => {
  it('extracts start/end times in lap order, ignoring a stale timestamp field', () => {
    const model: FitModel = {
      entries: [
        {
          mesgNum: Profile.MesgNum.LAP,
          mesg: {
            startTime: new Date('2026-07-01T10:00:00Z'),
            // A real Garmin Edge file was found with `timestamp` stuck at the
            // activity start on every lap; endTime must come from the next
            // lap's start (or totalElapsedTime), never from this field.
            timestamp: new Date('2026-07-01T10:00:00Z'),
            totalElapsedTime: 600,
            totalDistance: 1000,
            avgHeartRate: 145,
            avgPower: 210,
          },
        },
        {
          mesgNum: Profile.MesgNum.LAP,
          mesg: {
            startTime: new Date('2026-07-01T10:10:00Z'),
            timestamp: new Date('2026-07-01T10:00:00Z'),
            totalElapsedTime: 600,
            totalDistance: 1200,
          },
        },
      ],
    };

    const laps = lapBoundariesOf(model);
    expect(laps).toEqual([
      {
        index: 0,
        startTime: new Date('2026-07-01T10:00:00Z'),
        endTime: new Date('2026-07-01T10:10:00Z'),
        durationSeconds: 600,
        distanceMeters: 1000,
        avgHeartRate: 145,
        avgPower: 210,
        normalizedPower: null,
      },
      {
        index: 1,
        startTime: new Date('2026-07-01T10:10:00Z'),
        endTime: new Date('2026-07-01T10:20:00Z'),
        durationSeconds: 600,
        distanceMeters: 1200,
        avgHeartRate: null,
        avgPower: null,
        normalizedPower: null,
      },
    ]);
  });

  const lapStart = new Date('2026-07-01T10:00:00Z');

  function modelWithPowerRecords(powers: number[], lapSeconds: number, lapMesgExtra: object = {}): FitModel {
    return {
      entries: [
        {
          mesgNum: Profile.MesgNum.LAP,
          mesg: { startTime: lapStart, totalElapsedTime: lapSeconds, ...lapMesgExtra },
        },
        ...powers.map((power, i) => ({
          mesgNum: Profile.MesgNum.RECORD,
          mesg: { timestamp: new Date(lapStart.getTime() + i * 1000), power },
        })),
      ],
    };
  }

  it('passes through the lap message normalizedPower when the device recorded one', () => {
    const model = modelWithPowerRecords([200, 200], 60, { normalizedPower: 237 });
    expect(lapBoundariesOf(model)[0].normalizedPower).toBe(237);
  });

  it('computes NP from records at constant power as that power', () => {
    const model = modelWithPowerRecords(Array(60).fill(200), 60);
    expect(lapBoundariesOf(model)[0].normalizedPower).toBeCloseTo(200, 6);
  });

  it('computes NP above average power for variable effort', () => {
    // 60 s at 0 W then 60 s at 400 W: average is ~200 W, NP must be higher.
    const model = modelWithPowerRecords([...Array(60).fill(0), ...Array(60).fill(400)], 120);
    const np = lapBoundariesOf(model)[0].normalizedPower;
    expect(np).not.toBeNull();
    expect(np as number).toBeGreaterThan(220);
    expect(np as number).toBeLessThanOrEqual(400);
  });

  it('returns null NP when the lap has less than a full 30 s window of power', () => {
    const model = modelWithPowerRecords(Array(20).fill(200), 20);
    expect(lapBoundariesOf(model)[0].normalizedPower).toBeNull();
  });

  it('zero-fills long record gaps instead of carrying power across a pause', () => {
    // 30 s at 300 W, a 5-minute recording pause, then 30 s at 300 W. Forward-
    // filling the pause would yield NP ≈ 300; zero-filling must pull it down.
    const entries = [
      {
        mesgNum: Profile.MesgNum.LAP,
        mesg: { startTime: lapStart, totalElapsedTime: 360 },
      },
      ...Array.from({ length: 30 }, (_, i) => ({
        mesgNum: Profile.MesgNum.RECORD,
        mesg: { timestamp: new Date(lapStart.getTime() + i * 1000), power: 300 },
      })),
      ...Array.from({ length: 30 }, (_, i) => ({
        mesgNum: Profile.MesgNum.RECORD,
        mesg: { timestamp: new Date(lapStart.getTime() + (330 + i) * 1000), power: 300 },
      })),
    ];
    const np = lapBoundariesOf({ entries })[0].normalizedPower;
    expect(np).not.toBeNull();
    expect(np as number).toBeLessThan(250);
  });
});
