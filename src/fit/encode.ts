import { Encoder } from '@garmin/fitsdk';
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
  return encoder.close();
}
