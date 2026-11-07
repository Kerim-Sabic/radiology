/**
 * The RSNA-ICA series that may be shown in the product (RSNA's written permission: at most 100 MR and 100 CT series),
 * by opaque folder hash and modality only: no image, label, UID or patient detail. Written by
 * `scripts/rsna/publish_cases.py` when a teaching case is uploaded to private storage; the server serves slices of
 * these series and no others, and `tests/rsna.test.ts` fails at a 101st series of either kind.
 */
export interface ShownSeries {
  /** Folder of the series in private storage (`rsna-ica-<pack>/dicom/<series>/`), a 16-hex hash. */
  series: string;
  modality: 'MR' | 'CT';
}

export const RSNA_SHOWN: ShownSeries[] = [];
