import { describe, expect, it } from 'vitest';
import { CrcCalculator, Profile } from '@garmin/fitsdk';
import { decodeFitFile } from './decode';
import { encodeFitFile } from './encode';
import type { FitModel } from './model';

function buildSampleModel(): FitModel {
  return {
    entries: [
      {
        mesgNum: Profile.MesgNum.FILE_ID,
        mesg: {
          mesgNum: Profile.MesgNum.FILE_ID,
          type: 'activity',
          manufacturer: 'garmin',
          product: 3121, // edge530
          timeCreated: new Date('2026-07-01T10:00:00Z'),
        },
      },
      {
        mesgNum: Profile.MesgNum.RECORD,
        mesg: {
          mesgNum: Profile.MesgNum.RECORD,
          timestamp: new Date('2026-07-01T10:00:00Z'),
          positionLat: 473000000,
          positionLong: 85000000,
          altitude: 500.2,
          heartRate: 120,
          distance: 0,
          speed: 5.5,
        },
      },
      {
        mesgNum: Profile.MesgNum.RECORD,
        mesg: {
          mesgNum: Profile.MesgNum.RECORD,
          timestamp: new Date('2026-07-01T10:00:01Z'),
          positionLat: 473000100,
          positionLong: 85000100,
          altitude: 500.4,
          heartRate: 121,
          distance: 5.5,
          speed: 5.6,
        },
      },
      {
        mesgNum: Profile.MesgNum.LAP,
        mesg: {
          mesgNum: Profile.MesgNum.LAP,
          messageIndex: 0,
          startTime: new Date('2026-07-01T10:00:00Z'),
          timestamp: new Date('2026-07-01T10:00:01Z'),
          totalElapsedTime: 1,
          totalTimerTime: 1,
          totalDistance: 5.5,
        },
      },
    ],
  };
}

describe('FIT decode/encode round-trip', () => {
  it('re-encodes an in-memory model to bytes that decode back to equivalent messages', () => {
    const model = buildSampleModel();
    const bytes = encodeFitFile(model);

    const { model: decoded, errors } = decodeFitFile(bytes.buffer as ArrayBuffer);
    expect(errors).toEqual([]);

    expect(decoded.entries.map((e) => e.mesgNum)).toEqual(model.entries.map((e) => e.mesgNum));

    const record0 = decoded.entries[1].mesg as Record<string, unknown>;
    expect(record0.heartRate).toBe(120);
    expect(record0.distance).toBe(0);
    expect(record0.speed).toBe(5.5);
    expect((record0.timestamp as Date).toISOString()).toBe('2026-07-01T10:00:00.000Z');

    const fileId = decoded.entries[0].mesg as Record<string, unknown>;
    expect(fileId.manufacturer).toBe('garmin');
    expect(fileId.garminProduct).toBe('edge530');
  });

  it('rejects data that is not a FIT file', () => {
    const garbage = new TextEncoder().encode('not a fit file at all, just text');
    expect(() => decodeFitFile(garbage.buffer as ArrayBuffer)).toThrow(/does not look like a FIT file/);
  });

  it('decode(encode(decode(bytes))) is stable for a full encode/decode/encode cycle', () => {
    const model = buildSampleModel();
    const firstBytes = encodeFitFile(model);
    const { model: decodedOnce } = decodeFitFile(firstBytes.buffer as ArrayBuffer);
    const secondBytes = encodeFitFile(decodedOnce);
    const { model: decodedTwice, errors } = decodeFitFile(secondBytes.buffer as ArrayBuffer);

    expect(errors).toEqual([]);
    expect(decodedTwice).toEqual(decodedOnce);
  });

  it('omits NaN-valued float fields instead of letting the SDK corrupt them on encode', () => {
    // Regression test: found against a real Garmin Edge file where an unset,
    // scale-less float32 field (lap.totalGrit) decodes as NaN. Passing NaN
    // straight to the encoder makes it write 4294967296 — a value that reads
    // back as a normal (wrong) number instead of "no value". See encode.ts.
    const model: FitModel = {
      entries: [
        {
          mesgNum: Profile.MesgNum.LAP,
          mesg: {
            mesgNum: Profile.MesgNum.LAP,
            messageIndex: 0,
            totalElapsedTime: 60,
            totalGrit: NaN,
          },
        },
      ],
    };

    const bytes = encodeFitFile(model);
    const { model: decoded, errors } = decodeFitFile(bytes.buffer as ArrayBuffer);
    expect(errors).toEqual([]);

    const lap = decoded.entries[0].mesg as Record<string, unknown>;
    expect(lap.totalGrit).toBeUndefined();
    expect(lap.totalElapsedTime).toBe(60);
  });

  it('writes a spec-compliant protocol version byte, not the SDK encoder default', () => {
    // Regression test: @garmin/fitsdk's Encoder writes header byte 1 as the
    // literal decimal 2 instead of the nibble-packed 0x20 every real Garmin
    // device uses for protocol 2.0 — an invalid version identifier that
    // Garmin Connect's own upload validation rejects the whole file over.
    // See encode.ts's fixProtocolVersionByte.
    const model = buildSampleModel();
    const bytes = encodeFitFile(model);

    expect(bytes[1]).toBe(0x20);

    const headerSize = bytes[0];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const storedHeaderCrc = view.getUint16(headerSize - 2, true);
    expect(storedHeaderCrc).toBe(CrcCalculator.calculateCRC(bytes, 0, headerSize - 2));

    const storedFileCrc = view.getUint16(bytes.length - 2, true);
    expect(storedFileCrc).toBe(CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2));

    const { errors } = decodeFitFile(bytes.buffer as ArrayBuffer);
    expect(errors).toEqual([]);
  });
});
