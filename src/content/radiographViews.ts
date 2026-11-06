/**
 * Hanging protocol for radiographs with two or more views (book ch. 2: the chest is read on the PA and the lateral
 * together; ch. 24: a wrist on its frontal and lateral). Frontal on the left, lateral on the right.
 *
 * The view of each image is read, in order, from its DICOM ViewPosition (0018,5101), then its PatientOrientation
 * (0020,0020: the direction of the image rows - left/right on a frontal film, anterior/posterior on a lateral), then an
 * unambiguous series description. When any view stays unknown the stored order is kept: never guessed.
 */
export type XrView = 'frontal' | 'lateral';

const FRONTAL_VP = new Set(['PA', 'AP']);
const LATERAL_VP = new Set(['LL', 'RL', 'LAT', 'LATERAL', 'LLAT', 'RLAT']);

function orientationValues(po: unknown): string[] | null {
  if (po === null || po === undefined || po === '') return null;
  const v = Array.isArray(po) ? po.map(String) : String(po).split('\\');
  return v.length >= 2 ? v.map((x) => x.trim().toUpperCase()) : null;
}

export function radiographView(viewPosition: unknown, patientOrientation: unknown, description: string | null | undefined): XrView | null {
  const vp = String(viewPosition ?? '').trim().toUpperCase();
  if (FRONTAL_VP.has(vp)) return 'frontal';
  if (LATERAL_VP.has(vp)) return 'lateral';
  const po = orientationValues(patientOrientation);
  if (po) {
    // Rows run along the patient's left-right axis on a frontal film and front-to-back on a lateral one; the columns
    // run head-foot on both. Anything else (an oblique or an axial view) is not named.
    const row = po[0][0];
    const colHF = /^[HF]/.test(po[1]);
    if (colHF && (row === 'L' || row === 'R')) return 'frontal';
    if (colHF && (row === 'A' || row === 'P')) return 'lateral';
  }
  const d = ` ${String(description ?? '').toUpperCase().replace(/[^A-Z]+/g, ' ')} `;
  const lateral = / (LAT|LATERAL|LL|RL) /.test(d);
  const frontal = / (PA|AP|FRONTAL) /.test(d);
  if (lateral && !frontal) return 'lateral';
  if (frontal && !lateral) return 'frontal';
  return null;
}

/** Panel order: frontal first, then lateral, when every view is known; otherwise the stored order. */
export function hangRadiographs<T extends { view: XrView | null }>(items: T[]): T[] {
  if (items.some((x) => !x.view)) return [...items];
  const rank = (x: T) => (x.view === 'frontal' ? 0 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** The view a task's own words point to ("on the lateral", "the PA film"), if any. Anatomy that merely contains the word
 *  ("the lateral costophrenic angle") does not count. */
export function viewNamedIn(text: string): XrView | null {
  const lat = /\b(on|in) the lateral(?! (costophrenic|recess|ventricle|malleolus|condyle|epicondyle|meniscus|wall|aspect|border|side))\b|\blateral (view|film|radiograph|image|projection)\b/i;
  const fro = /\b(on|in) the (PA|AP|frontal)\b|\b(PA|AP|frontal) (view|film|radiograph|image|projection)\b/i;
  const l = lat.test(text);
  const f = fro.test(text);
  return l && !f ? 'lateral' : f && !l ? 'frontal' : null;
}

export const isRadiograph = (modality: string) => modality === 'CR' || modality === 'DX';
