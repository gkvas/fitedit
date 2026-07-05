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
      },
      {
        index: 1,
        startTime: new Date('2026-07-01T10:10:00Z'),
        endTime: new Date('2026-07-01T10:20:00Z'),
        durationSeconds: 600,
        distanceMeters: 1200,
        avgHeartRate: null,
        avgPower: null,
      },
    ]);
  });
});
