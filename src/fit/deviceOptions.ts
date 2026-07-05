import { Profile } from '@garmin/fitsdk';

export interface ManufacturerOption {
  value: string;
  label: string;
}

export interface ProductOption {
  value: number;
  label: string;
}

// A curated subset of Profile.types.manufacturer — the full enum has ~150
// entries, most of them obscure sensor/OEM vendors nobody hand-picks from a
// dropdown. These are the manufacturers whose activity files a user is
// actually likely to want to relabel between. Keys must match the SDK's
// camelCase enum names exactly (they're validated against the profile below).
const CURATED_MANUFACTURERS: Record<string, string> = {
  garmin: 'Garmin',
  wahooFitness: 'Wahoo',
  zwift: 'Zwift',
  hammerhead: 'Hammerhead',
  quarq: 'Quarq',
  faveroElectronics: 'Favero',
  polarElectro: 'Polar',
  suunto: 'Suunto',
  sigmasport: 'Sigma Sport',
  stagesCycling: 'Stages',
  tacx: 'Tacx',
  saris: 'Saris',
};

/** Manufacturer options for a device picker, limited to {@link CURATED_MANUFACTURERS} that exist in this SDK's profile. */
export function curatedManufacturerOptions(): ManufacturerOption[] {
  const known = new Set(Object.values(Profile.types.manufacturer));
  return Object.entries(CURATED_MANUFACTURERS)
    .filter(([value]) => known.has(value))
    .map(([value, label]) => ({ value, label }));
}

function humanizeProductName(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** All Garmin product options (device model names), sorted alphabetically. */
export function garminProductOptions(): ProductOption[] {
  return Object.entries(Profile.types.garminProduct)
    .map(([code, name]) => ({ value: Number(code), label: humanizeProductName(name) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
