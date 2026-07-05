import { describe, expect, it } from 'vitest';
import { Profile } from '@garmin/fitsdk';
import { changeDevice } from './device';
import type { FitModel } from '../model';

function modelWithFileId(): FitModel {
  return {
    entries: [
      {
        mesgNum: Profile.MesgNum.FILE_ID,
        mesg: {
          type: 'activity',
          manufacturer: 'garmin',
          product: 3121,
          garminProduct: 'edge530',
          serialNumber: 123456,
          timeCreated: new Date('2026-07-01T10:00:00Z'),
        },
      },
      {
        mesgNum: Profile.MesgNum.RECORD,
        mesg: { heartRate: 120 },
      },
    ],
  };
}

describe('changeDevice', () => {
  it('rewrites manufacturer and product, dropping stale derived fields', () => {
    const model = modelWithFileId();
    const result = changeDevice(model, { manufacturer: 'wahoo_fitness', product: 42 });

    const fileId = result.entries[0].mesg;
    expect(fileId.manufacturer).toBe('wahoo_fitness');
    expect(fileId.product).toBe(42);
    expect(fileId.garminProduct).toBeUndefined();
    // Unrelated fields are preserved.
    expect(fileId.serialNumber).toBe(123456);
    expect(fileId.type).toBe('activity');
  });

  it('clears product when none is given', () => {
    const model = modelWithFileId();
    const result = changeDevice(model, { manufacturer: 'zwift' });
    expect(result.entries[0].mesg.product).toBeUndefined();
  });

  it('leaves non-file_id messages untouched', () => {
    const model = modelWithFileId();
    const result = changeDevice(model, { manufacturer: 'zwift' });
    expect(result.entries[1]).toEqual(model.entries[1]);
  });

  it('does not mutate the input model', () => {
    const model = modelWithFileId();
    const original = structuredClone(model.entries[0].mesg);
    changeDevice(model, { manufacturer: 'zwift', product: 1 });
    expect(model.entries[0].mesg).toEqual(original);
  });
});
