import { CrcCalculator } from '@garmin/fitsdk';

export interface RawFieldDef {
  num: number;
  size: number;
  baseType: number;
  /** Byte offset of this field's value within the data record's payload (after the header byte). */
  offset: number;
}

export interface RawDefinition {
  littleEndian: boolean;
  globalMesgNum: number;
  fields: RawFieldDef[];
  /** Total bytes of developer fields, treated as an opaque trailing blob. */
  devFieldsSize: number;
  /** Total data-record payload size in bytes (profile fields + developer fields). */
  payloadSize: number;
}

export interface RawRecord {
  /** Absolute byte offset of the record's header byte. */
  offset: number;
  /** Total record length in bytes, including the header byte. */
  length: number;
  kind: 'definition' | 'data';
  localType: number;
  globalMesgNum: number;
  /** For data records: the definition active when this record was read. For definitions: the parsed definition. */
  def: RawDefinition;
}

export interface RawFitFile {
  bytes: Uint8Array;
  headerSize: number;
  /** Offset one past the last data record (start of the trailing file CRC). */
  dataEnd: number;
  records: RawRecord[];
}

export class RawFitParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawFitParseError';
  }
}

/**
 * Indexes a FIT file's raw bytes into a flat list of records with absolute
 * offsets, without decoding field values. This is the foundation for
 * byte-level editing: exports are produced by patching/splicing the original
 * device bytes rather than re-encoding through the SDK, because Garmin
 * Connect rejects files rebuilt by @garmin/fitsdk's encoder even though they
 * pass Garmin's own published reference decoder (verified empirically), and
 * because re-encoding silently drops every message/field the SDK's profile
 * doesn't know (more than half the bytes of a real Edge 840 file).
 */
export function parseRawFit(bytes: Uint8Array): RawFitFile {
  if (bytes.length < 14) throw new RawFitParseError('File too small to be FIT.');
  const headerSize = bytes[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = view.getUint32(4, true);
  const dataEnd = headerSize + dataSize;
  if (dataEnd + 2 > bytes.length) throw new RawFitParseError('Header data size exceeds file length.');

  const records: RawRecord[] = [];
  const activeDefs = new Map<number, RawDefinition>();
  let pos = headerSize;

  while (pos < dataEnd) {
    const hdr = bytes[pos];

    if (hdr & 0x80) {
      // Compressed-timestamp data record: local type in bits 5-6, 5-bit time offset.
      const localType = (hdr >> 5) & 0x3;
      const def = activeDefs.get(localType);
      if (!def) throw new RawFitParseError(`Data record at ${pos} references undefined local type ${localType}.`);
      records.push({ offset: pos, length: 1 + def.payloadSize, kind: 'data', localType, globalMesgNum: def.globalMesgNum, def });
      pos += 1 + def.payloadSize;
    } else if (hdr & 0x40) {
      const localType = hdr & 0xf;
      const hasDevFields = (hdr & 0x20) !== 0;
      const littleEndian = bytes[pos + 2] === 0;
      const globalMesgNum = littleEndian ? view.getUint16(pos + 3, true) : view.getUint16(pos + 3, false);
      const numFields = bytes[pos + 5];
      let p = pos + 6;
      const fields: RawFieldDef[] = [];
      let payloadOffset = 0;
      for (let i = 0; i < numFields; i++) {
        const size = bytes[p + 1];
        fields.push({ num: bytes[p], size, baseType: bytes[p + 2], offset: payloadOffset });
        payloadOffset += size;
        p += 3;
      }
      let devFieldsSize = 0;
      if (hasDevFields) {
        const numDevFields = bytes[p];
        p += 1;
        for (let i = 0; i < numDevFields; i++) {
          devFieldsSize += bytes[p + 1];
          p += 3;
        }
      }
      const def: RawDefinition = { littleEndian, globalMesgNum, fields, devFieldsSize, payloadSize: payloadOffset + devFieldsSize };
      activeDefs.set(localType, def);
      records.push({ offset: pos, length: p - pos, kind: 'definition', localType, globalMesgNum, def });
      pos = p;
    } else {
      const localType = hdr & 0xf;
      const def = activeDefs.get(localType);
      if (!def) throw new RawFitParseError(`Data record at ${pos} references undefined local type ${localType}.`);
      records.push({ offset: pos, length: 1 + def.payloadSize, kind: 'data', localType, globalMesgNum: def.globalMesgNum, def });
      pos += 1 + def.payloadSize;
    }
  }

  return { bytes, headerSize, dataEnd, records };
}

/**
 * Rewrites the header's data size and both CRCs after the byte stream has
 * been patched or resized. Mutates and returns `bytes`.
 */
export function finalizeFitBytes(bytes: Uint8Array): Uint8Array {
  const headerSize = bytes[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(4, bytes.length - headerSize - 2, true);
  if (headerSize >= 14) {
    view.setUint16(12, CrcCalculator.calculateCRC(bytes, 0, 12), true);
  }
  view.setUint16(bytes.length - 2, CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2), true);
  return bytes;
}
