/**
 * Certificate levels, the same for the app (which works them out from the learner's own answers) and the server
 * (which refuses anything below them). Each body area, and the whole library, has three levels, from Foundation to
 * Advanced; each level is its own certificate.
 */
export const CERT_AREAS = ['chest', 'abdomen', 'head', 'msk', 'breast', 'all'] as const;
export type CertArea = (typeof CERT_AREAS)[number];
export type CertLevel = 1 | 2 | 3;

export const CERT_TITLES: Record<CertArea, string> = {
  chest: 'Chest Imaging',
  abdomen: 'Abdominal and Pelvic Imaging',
  head: 'Neuroimaging',
  msk: 'Musculoskeletal Imaging',
  breast: 'Breast Imaging',
  all: 'General Radiology',
};

/** Skills a learner can attach to the certification on LinkedIn (names LinkedIn's skill list knows). */
export const CERT_SKILLS: Record<CertArea, string[]> = {
  chest: ['Radiology', 'Chest Radiography', 'Computed Tomography (CT)', 'Medical Imaging'],
  abdomen: ['Radiology', 'Abdominal Imaging', 'Computed Tomography (CT)', 'Medical Imaging'],
  head: ['Radiology', 'Neuroradiology', 'Magnetic Resonance Imaging (MRI)', 'Medical Imaging'],
  msk: ['Radiology', 'Musculoskeletal Radiology', 'X-ray', 'Medical Imaging'],
  breast: ['Radiology', 'Breast Imaging', 'Mammography', 'Ultrasound'],
  all: ['Radiology', 'Medical Imaging', 'Computed Tomography (CT)', 'Magnetic Resonance Imaging (MRI)', 'Ultrasound'],
};

export interface LevelRule {
  level: CertLevel;
  name: string;
  /** Patients read. In a body area with fewer patients, every patient there (never fewer than PATIENT_FLOOR). */
  minPatients: number;
  /** Graded answers (partly right counts half towards the share right). */
  minJudged: number;
  minAccuracy: number;
  /** Count only answers given without hints or reveal. */
  independent: boolean;
  /** The whole library only: at least `perArea` patients read in `minAreas` body areas. */
  minAreas?: number;
  perArea?: number;
}

export const PATIENT_FLOOR = 10;

export const LEVELS: { area: LevelRule[]; all: LevelRule[] } = {
  area: [
    { level: 1, name: 'Foundation', minPatients: 10, minJudged: 10, minAccuracy: 0.7, independent: false },
    { level: 2, name: 'Intermediate', minPatients: 25, minJudged: 30, minAccuracy: 0.8, independent: false },
    { level: 3, name: 'Advanced', minPatients: 40, minJudged: 30, minAccuracy: 0.85, independent: true },
  ],
  all: [
    { level: 1, name: 'Foundation', minPatients: 40, minJudged: 40, minAccuracy: 0.7, independent: false, minAreas: 3, perArea: 3 },
    { level: 2, name: 'Intermediate', minPatients: 100, minJudged: 100, minAccuracy: 0.8, independent: false, minAreas: 4, perArea: 10 },
    { level: 3, name: 'Advanced', minPatients: 200, minJudged: 100, minAccuracy: 0.85, independent: true, minAreas: 5, perArea: 10 },
  ],
};

export const levelRule = (area: CertArea, level: CertLevel): LevelRule => LEVELS[area === 'all' ? 'all' : 'area'][level - 1];
export const levelName = (level: CertLevel | undefined): string => LEVELS.area[(level ?? 1) - 1].name;

/** "Level 2 · Intermediate" */
export const levelLabel = (level: CertLevel | undefined): string => `Level ${level ?? 1} · ${levelName(level)}`;

/** The credential's full name, as on LinkedIn and the check page: "Chest Imaging Certificate – Level 2 (Intermediate)". */
export const credentialName = (title: string, level: CertLevel | undefined): string => `${title} Certificate – Level ${level ?? 1} (${levelName(level)})`;

/** What a level asks for, in one line. */
export function levelRequirement(area: CertArea, rule: LevelRule): string {
  const pct = `${Math.round(rule.minAccuracy * 100)}%`;
  const patients = area === 'all' ? `${rule.minPatients} patients across the library` : `${rule.minPatients} patients`;
  const breadth = rule.minAreas ? `, ${rule.perArea}+ in each of ${rule.minAreas} areas` : '';
  return `${patients}${breadth} · ${rule.minJudged} graded answers${rule.independent ? ' without hints' : ''} · ${pct} right`;
}

/** Each level has its own colour on the certificate (blue, teal, gold) and as many stars as its number. */
export const LEVEL_STYLE: Record<CertLevel, { accent: string; soft: string; line: string; ring: [string, string] }> = {
  1: { accent: '#1d4ed8', soft: '#eff4ff', line: '#c9d7fb', ring: ['#2563eb', '#1e40af'] },
  2: { accent: '#0f766e', soft: '#ecfdf7', line: '#b4e4d8', ring: ['#14b8a6', '#0f766e'] },
  3: { accent: '#a16207', soft: '#fdf8e8', line: '#ecd9a0', ring: ['#e3b341', '#a16207'] },
};

/** The points of a five-pointed star (for the seal), as an SVG polygon `points` string. */
export function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
