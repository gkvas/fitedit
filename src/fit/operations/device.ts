import { Profile } from '@garmin/fitsdk';
import type { FitModel, FitMesg } from '../model';

export interface DeviceChange {
  /** Friendly manufacturer name from `Profile.types.manufacturer`, e.g. `"garmin"`. */
  manufacturer: string;
  /** Raw numeric product code (e.g. resolved from `Profile.types.garminProduct`). Omit to clear it. */
  product?: number;
}

/**
 * Rewrites the file_id message's manufacturer/product — the fields tools like
 * Garmin Connect and Strava read to attribute "recorded with" a device.
 * Per-sensor `device_info` messages (HR strap, power meter, ...) are left
 * alone; only the file's own recording-device identity changes.
 */
export function changeDevice(model: FitModel, change: DeviceChange): FitModel {
  const entries = model.entries.map((entry) => {
    if (entry.mesgNum !== Profile.MesgNum.FILE_ID) return entry;

    const mesg: FitMesg = { ...entry.mesg, manufacturer: change.manufacturer };
    if (change.product !== undefined) {
      mesg.product = change.product;
    } else {
      delete mesg.product;
    }
    // Manufacturer-specific derived fields (garminProduct, faveroProduct, ...)
    // are decoder-only conveniences the encoder ignores (see encode.ts) and
    // are now stale, so drop them rather than leave misleading data around.
    delete mesg.garminProduct;
    delete mesg.faveroProduct;

    return { ...entry, mesg };
  });

  return { entries };
}
