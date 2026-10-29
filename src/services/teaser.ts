import { useEffect, useState } from 'react';
import { packBaseUrl } from './caseRepository';

/** Every patient in the full library, by neutral title only (no diagnosis): what membership unlocks. Written by the build. */
export interface TeaserCase {
  id: string;
  title: string;
  modality: string;
  region: string[];
  tasks: number;
}

let cache: Promise<TeaserCase[]> | null = null;

export function loadTeaser(): Promise<TeaserCase[]> {
  if (!cache) {
    cache = fetch(`${packBaseUrl()}teaser.json`, { cache: 'no-cache' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : { cases: [] }))
      .then((j: { cases?: TeaserCase[] }) => (Array.isArray(j.cases) ? j.cases : []))
      .catch(() => []);
    cache.then((c) => {
      if (!c.length) cache = null; // try again next time
    });
  }
  return cache;
}

export function useTeaser(enabled: boolean): TeaserCase[] {
  const [cases, setCases] = useState<TeaserCase[]>([]);
  useEffect(() => {
    if (enabled) void loadTeaser().then(setCases);
  }, [enabled]);
  return cases;
}

/** Plain modality name for a DICOM modality code. */
export function modalityName(m: string): string {
  return ({ CT: 'CT', MR: 'MRI', CR: 'X-ray', DX: 'X-ray', MG: 'Mammography', US: 'Ultrasound' } as Record<string, string>)[m] ?? m;
}
