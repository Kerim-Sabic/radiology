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

/**
 * The certification exam of each level: questions on real patients, every one graded automatically against the
 * expert's reference (no self-review, no machine outlines), answered without hints and without feedback until the
 * end. Each level is a real step up: more questions, a higher pass mark, a clock, more questions where you mark the
 * finding on the image instead of choosing an answer, no coin-toss questions, subtle cases, and no half points at the
 * top. The levels are taken in order. Passing an exam issues its certificate. (Certificates issued before the exams
 * record practice under LEVELS.)
 */
export interface ExamRule {
  level: CertLevel;
  questions: number;
  passMark: number;
  /** The whole library only: questions from at least this many body areas. */
  minAreas?: number;
  /** Time for each question, from when it opens; null for no limit. */
  secondsPerQuestion: number | null;
  /** Whether a partly right answer earns half a point (otherwise only fully right answers count). */
  partialCredit: boolean;
  /** At least this share of the questions asks you to mark the finding or structure on the image. */
  minMarking: number;
  /** Leave out questions with only two answers to choose from (a guess passes half of them). */
  noTwoOption: boolean;
  /** Which cases come first: typical ones, any, or subtle ones. */
  lean: 'typical' | 'any' | 'subtle';
  /** Hours to wait before trying again after an exam that was not passed. */
  retakeHours: number;
}

const L1 = { level: 1, passMark: 0.7, secondsPerQuestion: null, partialCredit: true, minMarking: 0, noTwoOption: false, lean: 'typical', retakeHours: 0 } as const;
const L2 = { level: 2, passMark: 0.8, secondsPerQuestion: 180, partialCredit: true, minMarking: 0.5, noTwoOption: true, lean: 'any', retakeHours: 1 } as const;
const L3 = { level: 3, passMark: 0.9, secondsPerQuestion: 120, partialCredit: false, minMarking: 0.6, noTwoOption: true, lean: 'subtle', retakeHours: 24 } as const;

export const EXAMS: { area: ExamRule[]; all: ExamRule[] } = {
  area: [
    { ...L1, questions: 15 },
    { ...L2, questions: 25 },
    { ...L3, questions: 40 },
  ],
  all: [
    { ...L1, questions: 30, minAreas: 3 },
    { ...L2, questions: 50, minAreas: 4 },
    { ...L3, questions: 75, minAreas: 5 },
  ],
};

export const examRule = (area: CertArea, level: CertLevel): ExamRule => EXAMS[area === 'all' ? 'all' : 'area'][level - 1];

const examFrom = (rule: { minAreas?: number }) => (rule.minAreas ? ` from ${rule.minAreas === 5 ? 'all 5' : `${rule.minAreas}+`} body areas` : '');
const clock = (s: number | null | undefined) => (s ? `${s % 60 ? `${s} s` : `${s / 60} min`} each` : 'untimed');

/** "25 questions · 3 min each · pass mark 80%" */
export function examRequirement(rule: ExamRule): string {
  return `${rule.questions} questions${examFrom(rule)} · ${clock(rule.secondsPerQuestion)} · pass mark ${Math.round(rule.passMark * 100)}%${rule.partialCredit ? '' : ' · no half points'}`;
}

/** What else makes a level hard, in a few words. */
export function examDetail(rule: ExamRule): string {
  const parts = [
    rule.minMarking ? `at least ${Math.round(rule.minMarking * 100)}% mark the finding on the image` : 'typical cases',
    rule.noTwoOption ? 'no two-answer questions' : null,
    rule.lean === 'subtle' ? 'subtle cases first' : null,
    rule.level > 1 ? `needs Level ${rule.level - 1}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** A certificate's numbers, as the server keeps them. */
export interface CertNumbers {
  area: string;
  level?: CertLevel;
  patients: number;
  judged: number;
  accuracy: number;
  exam?: { questions: number; passMark: number; secondsPerQuestion?: number | null; partialCredit?: boolean };
}
const areaOf = (c: CertNumbers) => ((CERT_AREAS as readonly string[]).includes(c.area) ? (c.area as CertArea) : 'chest');
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "Passed a 40-question exam on 38 real patients · 92% right (pass mark 90%)", or what an older certificate recorded. */
export function certResult(c: CertNumbers): string {
  if (c.exam) return `Passed a ${c.exam.questions}-question exam on ${c.patients} real patients · ${pct(c.accuracy)} right (pass mark ${pct(c.exam.passMark)})`;
  const unaided = levelRule(areaOf(c), c.level ?? 1).independent;
  return `${c.patients} real patients read · ${c.judged} graded answers${unaided ? ' without hints' : ''} · ${pct(c.accuracy)} right`;
}

/** What the certificate's level asked for when it was issued. */
export function certRequirement(c: CertNumbers): string {
  const area = areaOf(c);
  if (c.exam) {
    const e = c.exam;
    const timed = e.secondsPerQuestion ? `, ${clock(e.secondsPerQuestion)},` : '';
    const half = e.partialCredit === false ? '; only fully right answers count' : '';
    return `An exam of ${e.questions} questions${examFrom(examRule(area, c.level ?? 1))} on real patients${timed} without hints, each answer graded against the expert's reference${half}; pass mark ${pct(e.passMark)}`;
  }
  return levelRequirement(area, levelRule(area, c.level ?? 1));
}
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
