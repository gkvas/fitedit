import { describe, expect, it } from 'vitest';
import { Profile } from '@garmin/fitsdk';
import { shiftTime } from './shiftTime';
import type { FitModel } from '../model';

function sampleModel(): FitModel {
  return {
    entries: [
      {
        mesgNum: Profile.MesgNum.FILE_ID,
        mesg: {
          type: 'activity',
          manufacturer: 'garmin',
          timeCreated: new Date('2026-07-01T10:00:00Z'),
        },
      },
      {
        mesgNum: Profile.MesgNum.ACTIVITY,
        mesg: {
          timestamp: new Date('2026-07-01T12:34:56Z'),
          localTimestamp: 1152091973,
          numSessions: 1,
        },
      },
      {
        mesgNum: Profile.MesgNum.RECORD,
        mesg: {
          timestamp: new Date('2026-07-01T10:00:05Z'),
          heartRate: 120,
        },
      },
    ],
  };
}

describe('shiftTime', () => {
  it('shifts every Date-valued field by the given number of seconds', () => {
    const result = shiftTime(sampleModel(), 60);
    expect((result.entries[0].mesg.timeCreated as Date).toISOString()).toBe('2026-07-01T10:01:00.000Z');
    expect((result.entries[1].mesg.timestamp as Date).toISOString()).toBe('2026-07-01T12:35:56.000Z');
    expect((result.entries[2].mesg.timestamp as Date).toISOString()).toBe('2026-07-01T10:01:05.000Z');
  });

  it('shifts localDateTime-typed numeric fields by the same delta', () => {
    const result = shiftTime(sampleModel(), 60);
    expect(result.entries[1].mesg.localTimestamp).toBe(1152091973 + 60);
  });

  it('preserves relative timing between messages', () => {
    const result = shiftTime(sampleModel(), -120);
    const activityTime = (result.entries[1].mesg.timestamp as Date).getTime();
    const recordTime = (result.entries[2].mesg.timestamp as Date).getTime();
    const originalActivityTime = new Date('2026-07-01T12:34:56Z').getTime();
    const originalRecordTime = new Date('2026-07-01T10:00:05Z').getTime();
    expect(activityTime - recordTime).toBe(originalActivityTime - originalRecordTime);
  });

  it('leaves non-timestamp fields untouched', () => {
    const result = shiftTime(sampleModel(), 60);
    expect(result.entries[0].mesg.manufacturer).toBe('garmin');
    expect(result.entries[1].mesg.numSessions).toBe(1);
    expect(result.entries[2].mesg.heartRate).toBe(120);
  });

  it('rounds fractional seconds', () => {
    const result = shiftTime(sampleModel(), 1.7);
    expect((result.entries[2].mesg.timestamp as Date).toISOString()).toBe('2026-07-01T10:00:07.000Z');
  });

  it('does not mutate the input model', () => {
    const model = sampleModel();
    const original = structuredClone(model.entries[2].mesg);
    shiftTime(model, 60);
    expect(model.entries[2].mesg).toEqual(original);
  });
});
