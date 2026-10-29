/**
 * Certificates of completion, worked out from your own answers: three levels for each body area, and three for the
 * whole library. The rules live in shared/certificateLevels.ts (the server refuses anything below them). The server
 * keeps the issued certificate (name, numbers, date) behind a public check link.
 */
import type { AreaProgress } from './areas';
import type { Attempt } from './progressRepository';
import {
  CERT_SKILLS,
  CERT_TITLES,
  LEVELS,
  PATIENT_FLOOR,
  credentialName,
  levelLabel,
  levelRequirement,
  type CertArea,
  type CertLevel,
  type LevelRule,
} from '../../shared/certificateLevels';

export { CERT_TITLES, LEVELS, credentialName, levelLabel, levelRequirement };
export type { CertArea, CertLevel };

export interface CertStatus {
  area: CertArea;
  title: string;
  level: CertLevel;
  /** "Foundation", "Intermediate", "Advanced" */
  levelName: string;
  /** Patients in the library for this area. */
  patients: number;
  read: number;
  /** Graded answers counted for this level (only those without hints for an unaided level). */
  judged: number;
  accuracy: number | null;
  /** Patients needed (every patient of a smaller area, never fewer than the floor). */
  needPatients: number;
  needJudged: number;
  minAccuracy: number;
  independent: boolean;
  eligible: boolean;
  /** 0..1 towards the bar. */
  progress: number;
  /** What is still missing, in words. */
  todo: string | null;
}

const outcome = (a: Attempt) => a.grade?.outcome ?? a.selfReview?.verdict ?? null;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, word: string) => `${n} more ${word}${n === 1 ? '' : 's'}`;

/** Patients a level asks for in an area with `patients` of them. */
export function patientsNeeded(area: CertArea, rule: LevelRule, patients: number): number {
  return area === 'all' ? rule.minPatients : Math.max(PATIENT_FLOOR, Math.min(rule.minPatients, patients));
}

function levelStatus(area: CertArea, rule: LevelRule, read: number, patients: number, judged: number, accuracy: number | null, breadth: string | null = null): CertStatus {
  const needPatients = patientsNeeded(area, rule, patients);
  const okAcc = accuracy !== null && accuracy >= rule.minAccuracy;
  const eligible = patients >= needPatients && read >= needPatients && judged >= rule.minJudged && okAcc && !breadth;
  const unaided = rule.independent ? ' without hints' : '';
  const everyPatient = area !== 'all' && needPatients < rule.minPatients;
  const todo = eligible
    ? null
    : patients < needPatients
      ? `More patients in this area are on the way (${patients} so far; ${needPatients} needed).`
      : read < needPatients
        ? everyPatient
          ? `Read every patient in this area: ${plural(needPatients - read, 'patient')} to go.`
          : `Read ${plural(needPatients - read, 'patient')}.`
        : judged < rule.minJudged
          ? `Answer ${plural(rule.minJudged - judged, 'graded task')}${unaided}.`
          : !okAcc
            ? `Get to ${pct(rule.minAccuracy)} right${unaided} (now ${pct(accuracy ?? 0)}): retry your mistakes.`
            : breadth;
  const progress =
    (Math.min(read, needPatients) / needPatients) * 0.5 +
    (Math.min(judged, rule.minJudged) / rule.minJudged) * 0.25 +
    (okAcc ? 0.25 : ((accuracy ?? 0) / rule.minAccuracy) * 0.25);
  return {
    area,
    title: CERT_TITLES[area],
    level: rule.level,
    levelName: rule.name,
    patients,
    read,
    judged,
    accuracy,
    needPatients,
    needJudged: rule.minJudged,
    minAccuracy: rule.minAccuracy,
    independent: rule.independent,
    eligible,
    progress: eligible ? 1 : Math.min(progress, 0.99),
    todo,
  };
}

/** Every level of every area, then the whole library, in order. */
export function certificateStatus(areas: AreaProgress[], attempts: Attempt[]): CertStatus[] {
  const list: CertStatus[] = [];
  for (const a of areas)
    for (const rule of LEVELS.area)
      list.push(levelStatus(a.id as CertArea, rule, a.read, a.patients, rule.independent ? a.independentJudged : a.judged, rule.independent ? a.independentAccuracy : a.accuracy));
  // The whole library, with real breadth.
  const done = attempts.filter((a) => a.submittedAt);
  const score = (xs: Attempt[]) => {
    const judged = xs.filter((a) => ['correct', 'partial', 'incorrect'].includes(outcome(a) ?? ''));
    const points = judged.reduce((s, a) => s + (outcome(a) === 'correct' ? 1 : outcome(a) === 'partial' ? 0.5 : 0), 0);
    return { judged: judged.length, accuracy: judged.length ? points / judged.length : null };
  };
  const all = score(done);
  const unaided = score(done.filter((a) => a.independent));
  const read = new Set(done.map((a) => a.holdoutGroup)).size;
  const patients = areas.reduce((s, a) => s + a.patients, 0);
  for (const rule of LEVELS.all) {
    const wide = areas.filter((a) => a.read >= (rule.perArea ?? 0)).length;
    const breadth = wide < (rule.minAreas ?? 0) ? `Read at least ${rule.perArea} patients in ${rule.minAreas} body areas (${wide} so far).` : null;
    const s = rule.independent ? unaided : all;
    list.push(levelStatus('all', rule, read, patients, s.judged, s.accuracy, breadth));
  }
  return list;
}

export interface IssuedCertificate {
  id: string;
  name: string;
  area: string;
  /** Certificates issued before levels existed are level 1. */
  level?: CertLevel;
  title: string;
  patients: number;
  judged: number;
  accuracy: number;
  issuedAt: string;
}

export async function myCertificates(): Promise<IssuedCertificate[]> {
  try {
    const r = await fetch('/api/certificates', { cache: 'no-store' });
    if (!r.ok) return [];
    return ((await r.json()) as { certificates: IssuedCertificate[] }).certificates;
  } catch {
    return [];
  }
}

export async function claimCertificate(s: CertStatus, name: string): Promise<{ ok: true; certificate: IssuedCertificate } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: s.area, level: s.level, name, patients: s.read, judged: s.judged, accuracy: s.accuracy ?? 0 }),
    });
    const j = await r.json();
    return r.ok ? { ok: true, certificate: j.certificate } : { ok: false, error: j.error ?? 'Could not issue the certificate.' };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

/** What goes in LinkedIn's "Add license or certification" form, field by field. */
export function linkedInFields(c: IssuedCertificate, origin = location.origin) {
  return {
    name: credentialName(c.title, c.level),
    organization: 'radiology.monster',
    skills: CERT_SKILLS[(c.area as CertArea) in CERT_SKILLS ? (c.area as CertArea) : 'all'],
    issued: new Date(c.issuedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    credentialId: c.id,
    credentialUrl: `${origin}/certificate/${c.id}`,
  };
}

/**
 * LinkedIn's "Add license or certification" form. LinkedIn no longer fills it in from the link (the details below
 * are kept in case it does again), so the certificate page lists each field to copy.
 */
export function linkedInUrl(c: IssuedCertificate, origin = location.origin): string {
  const d = new Date(c.issuedAt);
  const f = linkedInFields(c, origin);
  const q = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: f.name,
    organizationName: f.organization,
    issueYear: String(d.getUTCFullYear()),
    issueMonth: String(d.getUTCMonth() + 1),
    certUrl: f.credentialUrl,
    certId: f.credentialId,
  });
  return `https://www.linkedin.com/profile/add?${q}`;
}

/** A sample certificate for the example page (never stored, never checkable). */
export const EXAMPLE_CERTIFICATE: IssuedCertificate = {
  id: 'example',
  name: 'Your Name',
  area: 'chest',
  level: 2,
  title: CERT_TITLES.chest,
  patients: 25,
  judged: 34,
  accuracy: 0.84,
  issuedAt: new Date().toISOString(),
};
