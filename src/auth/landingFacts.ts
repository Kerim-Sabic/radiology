/**
 * Numbers the public landing page states. The landing page never loads study content (visitors have no access), so
 * these are fixed here; tests/landingFacts.test.ts checks every claim against the installed commercial catalogue,
 * the condition list and the curriculum, so a claim can never be larger than what members actually get.
 */
export const LANDING_FACTS = {
  /** Distinct real patients (shown as "350+"). */
  patients: 350,
  /** Image tasks across all cases (shown as "1,000+"). */
  tasks: 1000,
  /** Conditions in the condition search (shown as "75+"). */
  conditions: 75,
  /** Learning objectives mapped from the book (exact). */
  objectives: 274,
  modalities: ['CT', 'MRI', 'X-ray', 'Mammography', 'Ultrasound'] as const,
};

/** A landing number as shown: 1000 → "1,000". */
export const fact = (n: number) => n.toLocaleString('en-US');

/** Data shown in the landing-page screenshots, with the credit each licence asks for. */
export const LANDING_CREDITS: Array<{ name: string; license: string; url: string }> = [
  { name: 'FUMPE (Masoudi et al., Sci Data 2018)', license: 'CC BY 4.0', url: 'https://doi.org/10.6084/m9.figshare.c.4107803.v1' },
  { name: 'C4KC-KiTS, The Cancer Imaging Archive', license: 'CC BY 3.0', url: 'https://doi.org/10.7937/TCIA.2019.IX49E8NX' },
  { name: 'ISLES 2022 (Hernandez Petzsche et al., Sci Data 2022)', license: 'CC BY 4.0', url: 'https://doi.org/10.5281/zenodo.7153326' },
  { name: 'CBIS-DDSM, The Cancer Imaging Archive', license: 'CC BY 3.0', url: 'https://doi.org/10.7937/K9/TCIA.2016.7O02S9CY' },
  { name: 'Breast-Lesions-USG (BrEaST), The Cancer Imaging Archive', license: 'CC BY 4.0', url: 'https://doi.org/10.7937/9wkk-q141' },
  { name: 'NIH ChestX-ray14, NIH Clinical Center (Wang et al., CVPR 2017)', license: 'NIH, unrestricted use', url: 'https://nihcc.app.box.com/v/ChestXray-NIHCC' },
];
