import { Decoder, Stream } from '@garmin/fitsdk';
import type { FitModel, FitMesgEntry, FitMesg } from './model';

export class InvalidFitFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFitFileError';
  }
}

export interface DecodeResult {
  model: FitModel;
  errors: Error[];
}

/** Decodes a FIT file's raw bytes into a {@link FitModel}, preserving message order. */
export function decodeFitFile(buffer: ArrayBuffer): DecodeResult {
  const stream = Stream.fromArrayBuffer(buffer);

  if (!Decoder.isFIT(stream)) {
    throw new InvalidFitFileError('This does not look like a FIT file.');
  }
  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) {
    throw new InvalidFitFileError('FIT file failed its integrity check (corrupt data or CRC mismatch).');
  }

  const entries: FitMesgEntry[] = [];
  const { errors } = decoder.read({
    mesgListener: (mesgNum, mesg) => {
      entries.push({ mesgNum, mesg: mesg as FitMesg });
    },
  });

  return { model: { entries }, errors };
}
