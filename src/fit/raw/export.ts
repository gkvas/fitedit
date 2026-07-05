import { Profile } from '@garmin/fitsdk';
import { mesgsOf, type FitModel, type FitMesg } from '../model';
import { parseRawFit, finalizeFitBytes } from './parse';
import { shiftTimestampsInPlace, patchFileIdInPlace, spliceLaps, type RawDeviceChange } from './patch';

function fileIdOf(model: FitModel): FitMesg | undefined {
  return mesgsOf<FitMesg>(model, Profile.MesgNum.FILE_ID)[0];
}

function timeShiftSecondsBetween(original: FitModel, current: FitModel): number {
  const before = fileIdOf(original)?.timeCreated;
  const after = fileIdOf(current)?.timeCreated;
  if (!(before instanceof Date) || !(after instanceof Date)) return 0;
  return Math.round((after.getTime() - before.getTime()) / 1000);
}

function deviceChangeBetween(original: FitModel, current: FitModel): RawDeviceChange | null {
  const before = fileIdOf(original);
  const after = fileIdOf(current);
  if (!before || !after) return null;
  if (before.manufacturer === after.manufacturer && before.product === after.product) return null;

  const manufacturerCode =
    typeof after.manufacturer === 'string'
      ? Number(
          Object.entries(Profile.types.manufacturer as Record<number, string>).find(
            ([, name]) => name === after.manufacturer,
          )?.[0],
        )
      : (after.manufacturer as number);
  if (!Number.isFinite(manufacturerCode)) return null;

  return {
    manufacturer: manufacturerCode,
    product: typeof after.product === 'number' ? after.product : undefined,
  };
}

function lapsChangedBetween(original: FitModel, current: FitModel, shiftSeconds: number): boolean {
  const before = mesgsOf<FitMesg>(original, Profile.MesgNum.LAP);
  const after = mesgsOf<FitMesg>(current, Profile.MesgNum.LAP);
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    const a = before[i].startTime;
    const b = after[i].startTime;
    if (!(a instanceof Date) || !(b instanceof Date)) return true;
    if (a.getTime() + shiftSeconds * 1000 !== b.getTime()) return true;
  }
  return false;
}

/**
 * Produces the download bytes by surgically patching the original device
 * file: in-place timestamp shift and file_id rewrite, plus lap splicing when
 * the lap layout changed. Everything the user didn't edit — including the
 * proprietary messages and fields no SDK understands — is emitted
 * byte-for-byte as the device wrote it. A zero-edit export is byte-identical
 * to the input. (Full decode→re-encode is not an option: Garmin Connect
 * rejects @garmin/fitsdk encoder output wholesale; see parse.ts.)
 */
export function exportEditedFit(originalBytes: Uint8Array, originalModel: FitModel, currentModel: FitModel): Uint8Array {
  const shiftSeconds = timeShiftSecondsBetween(originalModel, currentModel);
  const device = deviceChangeBetween(originalModel, currentModel);
  const lapsChanged = lapsChangedBetween(originalModel, currentModel, shiftSeconds);

  if (shiftSeconds === 0 && !device && !lapsChanged) {
    return originalBytes.slice();
  }

  const bytes = originalBytes.slice();
  const raw = parseRawFit(bytes);
  if (device) patchFileIdInPlace(raw, device);
  if (shiftSeconds !== 0) shiftTimestampsInPlace(raw, shiftSeconds);

  const patched = lapsChanged ? spliceLaps(raw, mesgsOf<FitMesg>(currentModel, Profile.MesgNum.LAP)) : bytes;
  return finalizeFitBytes(patched);
}
