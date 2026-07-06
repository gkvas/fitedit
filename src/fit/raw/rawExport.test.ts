import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Profile } from '@garmin/fitsdk';
import { decodeFitFile } from '../decode';
import { encodeFitFile } from '../encode';
import { parseRawFit, RawFitParseError } from './parse';
import { exportEditedFit } from './export';
import { addLapBoundary } from '../operations/laps';
import { changeDevice } from '../operations/device';
import type { FitModel, FitMesg } from '../model';

// A real device file exercises everything the synthetic fixtures can't:
// proprietary messages, multiple local-type reuses, developer-unknown fields.
const REAL_FILE = path.join(os.homedir(), 'samples/23490902108/23490902108_ACTIVITY.fit');
const hasRealFile = fs.existsSync(REAL_FILE);

function loadRealFile(): Uint8Array {
  return new Uint8Array(fs.readFileSync(REAL_FILE));
}

function decodeBytes(bytes: Uint8Array): FitModel {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const { model, errors } = decodeFitFile(buffer);
  expect(errors).toEqual([]);
  return model;
}

function sampleModel(): FitModel {
  return {
    entries: [
      {
        mesgNum: Profile.MesgNum.FILE_ID,
        mesg: {
          type: 'activity',
          manufacturer: 'garmin',
          product: 3121,
          timeCreated: new Date('2026-07-01T10:00:00Z'),
        },
      },
      {
        mesgNum: Profile.MesgNum.RECORD,
        mesg: { timestamp: new Date('2026-07-01T10:00:00Z'), heartRate: 120, distance: 0 },
      },
      {
        mesgNum: Profile.MesgNum.RECORD,
        mesg: { timestamp: new Date('2026-07-01T10:00:10Z'), heartRate: 130, distance: 50 },
      },
      {
        mesgNum: Profile.MesgNum.LAP,
        mesg: {
          messageIndex: 0,
          event: 'lap',
          eventType: 'stop',
          startTime: new Date('2026-07-01T10:00:00Z'),
          timestamp: new Date('2026-07-01T10:00:10Z'),
          totalElapsedTime: 10,
          totalDistance: 50,
        },
      },
      {
        mesgNum: Profile.MesgNum.SESSION,
        mesg: {
          messageIndex: 0,
          startTime: new Date('2026-07-01T10:00:00Z'),
          timestamp: new Date('2026-07-01T10:00:10Z'),
          numLaps: 1,
          sport: 'cycling',
        },
      },
    ],
  };
}

function sampleBytes(): Uint8Array {
  return encodeFitFile(sampleModel());
}

describe('parseRawFit', () => {
  it('indexes records whose lengths exactly tile the data section', () => {
    const bytes = sampleBytes();
    const raw = parseRawFit(bytes);
    const total = raw.records.reduce((sum, r) => sum + r.length, 0);
    expect(raw.headerSize + total).toBe(raw.dataEnd);
    expect(raw.dataEnd + 2).toBe(bytes.length);
    expect(raw.records.filter((r) => r.kind === 'data' && r.globalMesgNum === Profile.MesgNum.RECORD)).toHaveLength(2);
  });

  it('rejects non-FIT data', () => {
    expect(() => parseRawFit(new TextEncoder().encode('definitely not a fit file'))).toThrow();
  });

  it('rejects a definition record whose field table extends past the data section', () => {
    const bytes = sampleBytes();
    const firstDef = parseRawFit(bytes).records.find((r) => r.kind === 'definition')!;
    bytes[firstDef.offset + 5] = 0xff; // claim 255 fields
    expect(() => parseRawFit(bytes)).toThrow(RawFitParseError);
  });

  it('rejects a data record that extends past the data section', () => {
    const bytes = sampleBytes();
    const firstDef = parseRawFit(bytes).records.find((r) => r.kind === 'definition')!;
    bytes[firstDef.offset + 7] = 0xff; // inflate the first field's size so the payload overruns
    expect(() => parseRawFit(bytes)).toThrow(RawFitParseError);
  });
});

describe('exportEditedFit', () => {
  it('returns byte-identical output when nothing changed', () => {
    const bytes = sampleBytes();
    const model = decodeBytes(bytes);
    const out = exportEditedFit(bytes, model, model);
    expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
  });

  it('patches file_id manufacturer/product in place', () => {
    const bytes = sampleBytes();
    const model = decodeBytes(bytes);
    const out = exportEditedFit(bytes, model, changeDevice(model, { manufacturer: 'wahooFitness', product: 42 }));
    expect(out.length).toBe(bytes.length);

    const fileId = decodeBytes(out).entries.find((e) => e.mesgNum === Profile.MesgNum.FILE_ID)!.mesg;
    expect(fileId.manufacturer).toBe('wahooFitness');
    expect(fileId.product).toBe(42);
    // Untouched fields survive.
    expect(fileId.type).toBe('activity');
  });

  it('splices new laps and patches session numLaps', () => {
    const bytes = sampleBytes();
    const model = decodeBytes(bytes);
    const edited = addLapBoundary(model, new Date('2026-07-01T10:00:05Z'));
    const out = exportEditedFit(bytes, model, edited);

    const decoded = decodeBytes(out);
    const laps = decoded.entries.filter((e) => e.mesgNum === Profile.MesgNum.LAP).map((e) => e.mesg);
    expect(laps).toHaveLength(2);
    expect((laps[0].startTime as Date).toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect((laps[0].timestamp as Date).toISOString()).toBe('2026-07-01T10:00:05.000Z');
    expect((laps[1].startTime as Date).toISOString()).toBe('2026-07-01T10:00:05.000Z');
    expect(laps.map((l) => l.messageIndex)).toEqual([0, 1]);

    const session = decoded.entries.find((e) => e.mesgNum === Profile.MesgNum.SESSION)!.mesg;
    expect(session.numLaps).toBe(2);
    // Records are untouched.
    const records = decoded.entries.filter((e) => e.mesgNum === Profile.MesgNum.RECORD);
    expect(records).toHaveLength(2);
  });
});

describe.skipIf(!hasRealFile)('exportEditedFit against a real Edge 840 file', () => {
  it('zero-edit export is byte-identical to the original', () => {
    const bytes = loadRealFile();
    const model = decodeBytes(bytes);
    const out = exportEditedFit(bytes, model, model);
    expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
  });

  it('lap split keeps everything outside the summary block byte-identical', () => {
    const bytes = loadRealFile();
    const model = decodeBytes(bytes);
    const records = model.entries.filter((e) => e.mesgNum === Profile.MesgNum.RECORD);
    const mid = records[Math.floor(records.length / 2)].mesg.timestamp as Date;
    const edited = addLapBoundary(model, mid);
    const out = exportEditedFit(bytes, model, edited);

    const decoded = decodeBytes(out);
    const laps = decoded.entries.filter((e) => e.mesgNum === Profile.MesgNum.LAP).map((e) => e.mesg as FitMesg);
    expect(laps).toHaveLength(2);
    const session = decoded.entries.find((e) => e.mesgNum === Profile.MesgNum.SESSION)!.mesg;
    expect(session.numLaps).toBe(2);

    // Lap-referenced time_in_zone entries are gone; session/split ones remain.
    const tizRefs = decoded.entries
      .filter((e) => e.mesgNum === Profile.MesgNum.TIME_IN_ZONE)
      .map((e) => e.mesg.referenceMesg);
    expect(tizRefs).not.toContain('lap');
    expect(tizRefs).toContain('session');

    // The record stream after the summary block is preserved verbatim: the
    // raw index of the output must contain every original record message at
    // unchanged length, and the file must shrink only by the removed
    // lap/time_in_zone records minus the two inserted laps.
    const rawBefore = parseRawFit(bytes);
    const rawAfter = parseRawFit(out);
    const dataCount = (raw: ReturnType<typeof parseRawFit>, mesgNum: number) =>
      raw.records.filter((r) => r.kind === 'data' && r.globalMesgNum === mesgNum).length;
    expect(dataCount(rawAfter, Profile.MesgNum.RECORD)).toBe(dataCount(rawBefore, Profile.MesgNum.RECORD));
    expect(dataCount(rawAfter, 534)).toBe(dataCount(rawBefore, 534));
    expect(dataCount(rawAfter, Profile.MesgNum.LAP)).toBe(2);
  });
});
