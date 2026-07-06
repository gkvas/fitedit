import { Profile } from '@garmin/fitsdk';
import type { FitMesg } from '../model';
import { parseRawFit, finalizeFitBytes, type RawFitFile, type RawRecord, type RawFieldDef, type RawDefinition } from './parse';

const FIT_EPOCH_MS = 631065600000;
const MESSAGE_INDEX_FIELD = 254;

// Base type codes (low 5 bits identify the type; bit 7 flags multi-byte).
const BASE_TYPE_SIZES: Record<number, number> = {
  0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x07: 1,
  0x88: 4, 0x89: 8, 0x0a: 1, 0x8b: 2, 0x8c: 4, 0x0d: 1, 0x8e: 8, 0x8f: 8, 0x90: 8,
};

// The byte pattern meaning "no value", repeated across the field's width.
// Z-types and strings use zero; everything else is all-ones except signed
// types, whose invalid is the max positive value.
const INVALID_BYTES: Record<number, number[]> = {
  0x00: [0xff], 0x01: [0x7f], 0x02: [0xff], 0x83: [0xff, 0x7f], 0x84: [0xff, 0xff],
  0x85: [0xff, 0xff, 0xff, 0x7f], 0x86: [0xff, 0xff, 0xff, 0xff], 0x07: [0x00],
  0x88: [0xff, 0xff, 0xff, 0xff], 0x89: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
  0x0a: [0x00], 0x8b: [0x00, 0x00], 0x8c: [0x00, 0x00, 0x00, 0x00], 0x0d: [0xff],
  0x8e: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f],
  0x8f: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
  0x90: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

interface ProfileField {
  num: number;
  name: string;
  type: string;
  baseType: string;
  scale: number;
  offset: number;
  array: boolean | string;
}

function profileFieldsOf(mesgNum: number): Record<number, ProfileField> {
  return (Profile.messages as Record<number, { fields: Record<number, ProfileField> }>)[mesgNum]?.fields ?? {};
}

function readU16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
}

function writeU16(bytes: Uint8Array, offset: number, value: number, littleEndian: boolean): void {
  if (littleEndian) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
  } else {
    bytes[offset] = (value >> 8) & 0xff;
    bytes[offset + 1] = value & 0xff;
  }
}

function writeU32(bytes: Uint8Array, offset: number, value: number, littleEndian: boolean): void {
  if (littleEndian) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  } else {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }
}

export interface RawDeviceChange {
  /** Raw manufacturer code from `Profile.types.manufacturer`. */
  manufacturer: number;
  /** Raw product code; omit to clear the field (written as invalid). */
  product?: number;
}

/** Patches the file_id message's manufacturer/product fields in place. */
export function patchFileIdInPlace(raw: RawFitFile, change: RawDeviceChange): void {
  const fileId = raw.records.find((r) => r.kind === 'data' && r.globalMesgNum === Profile.MesgNum.FILE_ID);
  if (!fileId) return;
  for (const field of fileId.def.fields) {
    const at = fileId.offset + 1 + field.offset;
    if (field.num === 1 && field.size === 2) {
      writeU16(raw.bytes, at, change.manufacturer, fileId.def.littleEndian);
    } else if (field.num === 2 && field.size === 2) {
      writeU16(raw.bytes, at, change.product ?? 0xffff, fileId.def.littleEndian);
    }
  }
}

function invalidPayload(def: RawDefinition): Uint8Array {
  const payload = new Uint8Array(def.payloadSize);
  for (const field of def.fields) {
    const pattern = INVALID_BYTES[field.baseType] ?? [0xff];
    for (let i = 0; i < field.size; i++) {
      payload[field.offset + i] = pattern[i % pattern.length];
    }
  }
  payload.fill(0xff, payload.length - def.devFieldsSize);
  return payload;
}

// Decoded lap keys whose value can stand in for a profile field of a
// different name present in the device's lap definition.
const FIELD_NAME_ALIASES: Record<string, string> = {
  enhancedAvgSpeed: 'avgSpeed',
  enhancedMaxSpeed: 'maxSpeed',
};

/**
 * Converts a decoded ("friendly") field value back to its raw wire value
 * using the profile's scale/offset/type, mirroring the SDK decoder's
 * transformation in reverse. Returns null when the value can't be honestly
 * represented (missing, wrong type, out of range), in which case the field
 * keeps its invalid pattern.
 */
function rawFieldValue(mesgNum: number, fieldNum: number, mesg: FitMesg): number | null {
  const meta = profileFieldsOf(mesgNum)[fieldNum];
  if (!meta || meta.array) return null;
  let value = mesg[meta.name];
  if (value === undefined && FIELD_NAME_ALIASES[meta.name]) value = mesg[FIELD_NAME_ALIASES[meta.name]];
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Math.round((value.getTime() - FIT_EPOCH_MS) / 1000);
  }
  if (typeof value === 'string') {
    const typeMap = (Profile.types as Record<string, Record<number, string>>)[meta.type];
    if (!typeMap) return null;
    for (const [code, name] of Object.entries(typeMap)) {
      if (name === value) return Number(code);
    }
    return null;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round((value + meta.offset) * meta.scale);
}

function writeFieldValue(payload: Uint8Array, field: RawFieldDef, value: number, littleEndian: boolean): void {
  switch (BASE_TYPE_SIZES[field.baseType]) {
    case 1:
      payload[field.offset] = value & 0xff;
      break;
    case 2:
      writeU16(payload, field.offset, value & 0xffff, littleEndian);
      break;
    case 4:
      writeU32(payload, field.offset, value >>> 0, littleEndian);
      break;
    default:
      break; // 8-byte fields: nothing we compute needs them; leave invalid.
  }
}

function isLapReferencedTimeInZone(raw: RawFitFile, record: RawRecord): boolean {
  if (record.globalMesgNum !== Profile.MesgNum.TIME_IN_ZONE || record.kind !== 'data') return false;
  const refField = record.def.fields.find((f) => f.num === 0);
  if (!refField || refField.size !== 2) return false;
  return readU16(raw.bytes, record.offset + 1 + refField.offset, record.def.littleEndian) === Profile.MesgNum.LAP;
}

/**
 * Replaces the file's lap messages with `newLaps` (decoded lap objects, as
 * produced by the lap operations), returning a new byte array. The new laps
 * are written where the file's first lap record sat, under the lap message
 * definition already active there — Garmin devices write laps contiguously
 * in a summary block, so this keeps the surrounding stream byte-identical.
 * Fields in the device's lap definition that we can't recompute are written
 * as invalid rather than left with stale values. Lap-referenced time_in_zone
 * records are removed (their per-lap zone breakdown describes the old lap
 * layout; see rebuildWithLaps in operations/laps.ts), and the session's
 * num_laps is patched to match.
 */
export function spliceLaps(raw: RawFitFile, newLaps: FitMesg[]): Uint8Array {
  const lapRecords = raw.records.filter((r) => r.kind === 'data' && r.globalMesgNum === Profile.MesgNum.LAP);
  if (lapRecords.length === 0) throw new Error('File has no lap messages to replace.');
  // A compressed-timestamp record's 2-bit local type lives in a different
  // namespace than the normal 4-bit one, so it can't serve as the header of
  // the plain data records we emit — the spliced laps would decode under
  // whatever definition owns that slot.
  const template = lapRecords.find((r) => (raw.bytes[r.offset] & 0x80) === 0);
  if (!template) throw new Error('File has no plain-header lap record to use as a splice template.');
  const removed = new Set<RawRecord>(lapRecords);
  for (const record of raw.records) {
    if (isLapReferencedTimeInZone(raw, record)) removed.add(record);
  }

  const session = raw.records.find((r) => r.kind === 'data' && r.globalMesgNum === Profile.MesgNum.SESSION);
  if (session) {
    const numLapsField = session.def.fields.find((f) => f.num === 26 && f.size === 2);
    if (numLapsField) {
      writeU16(raw.bytes, session.offset + 1 + numLapsField.offset, newLaps.length, session.def.littleEndian);
    }
  }

  const sorted = [...newLaps].sort((a, b) => (a.startTime as Date).getTime() - (b.startTime as Date).getTime());
  const lapBytes: Uint8Array[] = sorted.map((lap, index) => {
    const record = new Uint8Array(1 + template.def.payloadSize);
    record[0] = template.localType;
    const payload = invalidPayload(template.def);
    for (const field of template.def.fields) {
      const value =
        field.num === MESSAGE_INDEX_FIELD ? index : rawFieldValue(Profile.MesgNum.LAP, field.num, lap);
      if (value !== null) writeFieldValue(payload, field, value, template.def.littleEndian);
    }
    record.set(payload, 1);
    return record;
  });

  const newLapsSize = lapBytes.reduce((sum, b) => sum + b.length, 0);
  const removedSize = [...removed].reduce((sum, r) => sum + r.length, 0);
  const out = new Uint8Array(raw.bytes.length - removedSize + newLapsSize);

  let src = 0;
  let dst = 0;
  const copyThrough = (end: number) => {
    out.set(raw.bytes.subarray(src, end), dst);
    dst += end - src;
    src = end;
  };

  for (const record of raw.records) {
    if (record === template) {
      copyThrough(record.offset);
      for (const lap of lapBytes) {
        out.set(lap, dst);
        dst += lap.length;
      }
      src = record.offset + record.length;
    } else if (removed.has(record)) {
      copyThrough(record.offset);
      src = record.offset + record.length;
    }
  }
  copyThrough(raw.bytes.length);

  return out;
}

export { parseRawFit, finalizeFitBytes };
