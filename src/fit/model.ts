import type { Mesg } from '@garmin/fitsdk';

/**
 * A decoded FIT message. Widened with an index signature (vs. the SDK's bare
 * `Mesg`) so object literals for specific message types (`FileIdMesg`,
 * `RecordMesg`, ...) can be assigned here without excess-property errors.
 */
export type FitMesg = Mesg & { [field: string]: unknown };

/** A single decoded FIT message, tagged with its global message number. */
export interface FitMesgEntry {
  mesgNum: number;
  mesg: FitMesg;
}

/**
 * A FIT file's messages in original file order. This is the single source of
 * truth for both editing and re-encoding: `entries` order is what gets written
 * back out, and typed accessors below are just filtered views over it.
 *
 * Messages use the SDK's "friendly" decoded shape (scale/offset applied, enums
 * as strings, timestamps as Date) — the Encoder accepts this same shape
 * directly, so no separate raw/display representation is needed.
 */
export interface FitModel {
  entries: FitMesgEntry[];
}

export function mesgsOf<T extends Mesg>(model: FitModel, mesgNum: number): T[] {
  const result: T[] = [];
  for (const entry of model.entries) {
    if (entry.mesgNum === mesgNum) result.push(entry.mesg as unknown as T);
  }
  return result;
}
