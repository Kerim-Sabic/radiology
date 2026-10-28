/**
 * MRI sequence guide: which sequence a series is (from its description and acquisition parameters) and what is
 * bright and dark on it — the questions Learning Radiology (ch. 20, "How to Identify a T1-Weighted or T2-Weighted
 * Image", printed p. 238) teaches you to ask first. Conservative: unknown stays unknown.
 */
export type SequenceId = 'T1' | 'T1C' | 'T2' | 'FLAIR' | 'STIR' | 'PD' | 'DWI' | 'ADC' | 'GRE';

export interface SequenceInfo {
  id: SequenceId;
  label: string;
  /** One-line rule shown on the image. */
  short: string;
  bright: string;
  dark: string;
  tip: string;
}

/** Book anchor for the T1/T2 teaching (physical PDF page and printed page). */
export const SEQUENCE_BOOK = { physical: 258, printed: '238', heading: 'How to Identify a T1-Weighted or T2-Weighted Image' };

export const SEQUENCES: Record<SequenceId, SequenceInfo> = {
  T1: {
    id: 'T1',
    label: 'T1-weighted',
    short: 'fat bright, fluid dark',
    bright: 'Fat (subcutaneous fat, marrow, orbit fat); subacute blood (methemoglobin); gadolinium; melanin and protein-rich fluid.',
    dark: 'Fluid: CSF, urine, simple cysts, edema; cortical bone and air.',
    tip: 'Best for anatomy. Look at the CSF or bladder: dark means T1.',
  },
  T1C: {
    id: 'T1C',
    label: 'T1-weighted after gadolinium',
    short: 'enhancing tissue bright',
    bright: 'Tissue that takes up gadolinium: vessels, tumor, inflammation, where the blood-brain barrier is broken; fat (unless fat-suppressed).',
    dark: 'Fluid (CSF stays dark), necrosis, cortical bone, air.',
    tip: 'Compare with the T1 before contrast: only what got brighter is enhancement.',
  },
  T2: {
    id: 'T2',
    label: 'T2-weighted',
    short: 'fluid bright',
    bright: 'Fluid: CSF, urine, cysts, edema and most pathology (water content); fat is also fairly bright on fast spin-echo.',
    dark: 'Cortical bone, air, calcium, fast-flowing blood (flow voids), fibrous tissue; some blood products.',
    tip: 'Look at the CSF or bladder: white means T2. Most disease is brighter than normal tissue here.',
  },
  FLAIR: {
    id: 'FLAIR',
    label: 'FLAIR (T2 with fluid suppressed)',
    short: 'T2 but CSF dark',
    bright: 'Edema, gliosis, demyelination (e.g. multiple sclerosis plaques), infarcts — lesions next to CSF stand out.',
    dark: 'Free fluid: CSF in the ventricles and sulci is nulled.',
    tip: 'Brain lesions that touch the ventricles are easiest to see on FLAIR.',
  },
  STIR: {
    id: 'STIR',
    label: 'STIR (fat-suppressed, fluid-sensitive)',
    short: 'fat dark, fluid and edema bright',
    bright: 'Fluid and edema — marrow edema (bruise, fracture, tumor, infection) stands out.',
    dark: 'Fat is suppressed: subcutaneous fat and normal marrow turn dark.',
    tip: 'The sensitive sequence for bone and soft-tissue edema.',
  },
  PD: {
    id: 'PD',
    label: 'Proton density',
    short: 'high detail, fluid intermediate-bright',
    bright: 'Fat; fluid is fairly bright; cartilage is intermediate.',
    dark: 'Tendons, ligaments, menisci, cortical bone.',
    tip: 'Used in joints (knee, shoulder) for menisci, cartilage and ligaments.',
  },
  DWI: {
    id: 'DWI',
    label: 'Diffusion-weighted (DWI)',
    short: 'restricted diffusion bright',
    bright: 'Restricted diffusion: acute infarct (within minutes), abscess pus, very cellular tumor, epidermoid.',
    dark: 'Free water: CSF.',
    tip: 'Bright on DWI and dark on the ADC map = true restriction (e.g. acute stroke). Bright on both = "T2 shine-through".',
  },
  ADC: {
    id: 'ADC',
    label: 'ADC map',
    short: 'restricted diffusion dark',
    bright: 'Free water (CSF); T2 shine-through stays bright.',
    dark: 'Restricted diffusion: acute infarct, abscess, cellular tumor.',
    tip: 'Read it with the DWI: true restriction is dark here.',
  },
  GRE: {
    id: 'GRE',
    label: 'Gradient echo T2* / susceptibility',
    short: 'blood and calcium dark (bloom)',
    bright: 'Fluid moderately.',
    dark: 'Blood products (hemosiderin, deoxyhemoglobin), calcium and metal "bloom" larger than they are.',
    tip: 'Looks for old or small hemorrhage (microbleeds) and calcification.',
  },
};

type Acq = Record<string, string | number | string[] | null | undefined>;
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);

/** Sequence of an MR series, or null when the description and parameters do not say clearly. */
export function classifySequence(description: string, acq: Acq): SequenceInfo | null {
  const d = `${description} ${String(acq.SequenceName ?? '')} ${String(acq.SeriesDescription ?? '')}`.toLowerCase();
  const it = String(Array.isArray(acq.ImageType) ? acq.ImageType.join('\\') : (acq.ImageType ?? '')).toLowerCase();
  const contrast = !!acq.ContrastBolusAgent || /\b(post|gad|gd|contrast|\+c|c\+|ce)\b|post[-_ ]?contrast|postgad/.test(d);
  if (/\badc\b|apparent diffusion/.test(d) || /\badc\b/.test(it)) return SEQUENCES.ADC;
  if (/\bdwi\b|diffusion|\btrace\b|\bb[ =_-]?(800|1000|1500)\b|ep2d_diff/.test(d)) return SEQUENCES.DWI;
  if (/flair|\bdark[ -]?fluid\b/.test(d)) return SEQUENCES.FLAIR;
  if (/\bstir\b|\btirm\b/.test(d)) return SEQUENCES.STIR;
  if (/\bswi\b|susceptib|t2\*|t2star|\bgre\b|hemo|\bfl2d\b/.test(d)) return SEQUENCES.GRE;
  if (/\bpd\b|proton[ -]?density/.test(d)) return SEQUENCES.PD;
  if (/\bt1\b|t1w|t1[-_ ]|mprage|spgr|\bvibe\b|\btfl\b/.test(d)) return contrast ? SEQUENCES.T1C : SEQUENCES.T1;
  if (/\bt2\b|t2w|t2[-_ ]|haste|\bssfse\b/.test(d)) return SEQUENCES.T2;
  // No name: fall back on TR/TE only when they are unambiguous (spin echo).
  const tr = num(acq.RepetitionTime);
  const te = num(acq.EchoTime);
  const ti = num(acq.InversionTime);
  if (ti !== null && ti > 1500) return SEQUENCES.FLAIR;
  if (ti !== null && ti > 100 && ti < 250) return SEQUENCES.STIR;
  if (tr !== null && te !== null) {
    if (tr < 800 && te < 30) return contrast ? SEQUENCES.T1C : SEQUENCES.T1;
    if (tr > 2000 && te > 80) return SEQUENCES.T2;
    if (tr > 2000 && te < 30) return SEQUENCES.PD;
  }
  return null;
}
