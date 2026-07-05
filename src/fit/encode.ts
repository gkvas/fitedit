import { Encoder, CrcCalculator } from '@garmin/fitsdk';
import type { FitModel, FitMesg } from './model';

/**
 * Drops null/undefined/NaN fields rather than passing them through as
 * explicit values. An absent field and an explicit "no value" mean the same
 * thing in FIT, and passing one of these through is actively harmful for
 * scale-less floating-point fields: the SDK's encoder writes the float32
 * "invalid" sentinel (bit pattern 0xFFFFFFFF) as the literal number
 * 4294967295, which isn't exactly representable in float32 and rounds to
 * 4294967296 — a value that no longer decodes back as invalid, silently
 * corrupting the field (confirmed against a real Garmin Edge file, whose
 * `totalGrit`/`avgFlow` fields decode as `NaN` when unset). Omitting the key
 * sidesteps the bug entirely.
 */
function withoutEmptyFields(mesg: FitMesg): FitMesg {
  const cleaned: FitMesg = {};
  for (const [key, value] of Object.entries(mesg)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' && Number.isNaN(value)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Works around a bug in @garmin/fitsdk's `Encoder`: it writes the FIT
 * header's Protocol Version byte as the literal decimal value `2`, instead
 * of the spec's nibble-packed encoding (major version in the high nibble,
 * minor in the low nibble — protocol 2.0 is `0x20`, the same scheme every
 * real Garmin device uses, e.g. `0x10` for protocol 1.0). Confirmed against
 * a real Garmin Edge file: the device wrote `0x10`; this SDK's encoder
 * writes `0x02` — not a valid protocol version identifier, and Garmin
 * Connect's own upload validation silently rejects the file over it even
 * though every other part of it decodes without error. Patches the byte in
 * place and recomputes the header and file CRCs, both of which cover it.
 */
function fixProtocolVersionByte(bytes: Uint8Array): Uint8Array {
  const fixed = new Uint8Array(bytes);
  const headerSize = fixed[0];
  fixed[1] = 0x20;

  const view = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
  view.setUint16(headerSize - 2, CrcCalculator.calculateCRC(fixed, 0, headerSize - 2), true);
  view.setUint16(fixed.length - 2, CrcCalculator.calculateCRC(fixed, 0, fixed.length - 2), true);

  return fixed;
}

/** Encodes a {@link FitModel} back into FIT file bytes, writing messages in model order. */
export function encodeFitFile(model: FitModel): Uint8Array {
  const encoder = new Encoder();
  for (const { mesgNum, mesg } of model.entries) {
    const cleaned = withoutEmptyFields(mesg);
    // A message can decode with zero fields when every field it contains is
    // unrecognized by this SDK's profile version (seen on a real Garmin
    // training_settings message). It carries no information, and the encoder
    // can't build a field-less message definition, so skip it.
    if (Object.keys(cleaned).length === 0) continue;
    encoder.onMesg(mesgNum, cleaned);
  }
  return fixProtocolVersionByte(encoder.close());
}
