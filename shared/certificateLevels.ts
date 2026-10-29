/**
 * Certificate levels, the same for the app (which works them out from the learner's own answers) and the server
 * (which refuses anything below them). Each body area, and the whole library, has three levels; each level is its
 * own certificate.
 */
export const CERT_AREAS = ['chest', 'abdomen', 'head', 'msk', 'breast', 'all'] as const;
export type CertArea = (typeof CERT_AREAS)[number];
export type CertLevel = 1 | 2 | 3;

export const CERT_TITLES: Record<CertArea, string> = {
  chest: 'Chest imaging',
  abdomen: 'Abdominal and pelvic imaging',
  head: 'Neuroimaging',
  msk: 'Musculoskeletal imaging',
  breast: 'Breast imaging',
  all: 'General radiology',
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
    { level: 1, name: 'Core', minPatients: 10, minJudged: 10, minAccuracy: 0.7, independent: false },
    { level: 2, name: 'Proficient', minPatients: 25, minJudged: 30, minAccuracy: 0.8, independent: false },
    { level: 3, name: 'Advanced', minPatients: 40, minJudged: 30, minAccuracy: 0.85, independent: true },
  ],
  all: [
    { level: 1, name: 'Core', minPatients: 40, minJudged: 40, minAccuracy: 0.7, independent: false, minAreas: 3, perArea: 3 },
    { level: 2, name: 'Proficient', minPatients: 100, minJudged: 100, minAccuracy: 0.8, independent: false, minAreas: 4, perArea: 10 },
    { level: 3, name: 'Advanced', minPatients: 200, minJudged: 100, minAccuracy: 0.85, independent: true, minAreas: 5, perArea: 10 },
  ],
};

export const levelRule = (area: CertArea, level: CertLevel): LevelRule => LEVELS[area === 'all' ? 'all' : 'area'][level - 1];

/** "Level 2 · Proficient" */
export const levelLabel = (level: CertLevel | undefined): string => {
  const l = level ?? 1;
  return `Level ${l} · ${LEVELS.area[l - 1].name}`;
};
