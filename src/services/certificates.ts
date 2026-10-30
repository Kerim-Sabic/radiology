/**
 * Certificates of completion, worked out from your own answers: three levels for each body area, and three for the
 * whole library. The rules live in shared/certificateLevels.ts (the server refuses anything below them). The server
 * keeps the issued certificate (name, numbers, date) behind a public check link.
 */
import type { AreaProgress } from './areas';
import type { Attempt } from './progressRepository';
import { linkedinCredentialUrl, verificationUrl } from '../../shared/credential';
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
  requirements?: string;
  issuer?: string;
  verification?: 'server-graded' | 'legacy-self-reported';
  status?: 'active' | 'revoked';
  revokedAt?: string;
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

/** Whether the signed-in account holds this certificate, and whether the server can post it to LinkedIn for them. */
export async function certificateOwner(id: string): Promise<{ mine: boolean; linkedin: boolean }> {
  try {
    const r = await fetch('/api/certificates', { cache: 'no-store' });
    if (!r.ok) return { mine: false, linkedin: false };
    const j = (await r.json()) as { certificates: IssuedCertificate[]; linkedin?: boolean };
    return { mine: j.certificates.some((c) => c.id === id), linkedin: j.linkedin === true };
  } catch {
    return { mine: false, linkedin: false };
  }
}

/** Starts "Post it for me": the address of LinkedIn's sign-in, where the learner allows the one post. */
export async function startLinkedInPost(id: string, text: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/linkedin/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, text }) });
    const j = await r.json();
    return r.ok && typeof j.url === 'string' ? { ok: true, url: j.url } : { ok: false, error: j.error ?? 'Could not open LinkedIn.' };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

export async function claimCertificate(s: CertStatus, name: string, email = false): Promise<{ ok: true; certificate: IssuedCertificate } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: s.area, level: s.level, name, email }),
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
    credentialUrl: verificationUrl(c.id, origin),
  };
}

/**
 * LinkedIn's "Add license or certification" form. LinkedIn may not fill every field from the link (the details below
 * are kept in case it does again), so the certificate page lists each field to copy.
 */
export function linkedInUrl(c: IssuedCertificate, origin = location.origin): string {
  return linkedinCredentialUrl({...c,title:credentialName(c.title,c.level)},origin,import.meta.env.VITE_LINKEDIN_ORG_ID);
}

export async function verifiedCertificateStatuses(): Promise<CertStatus[]> {
  const r=await fetch('/api/certificates/progress',{cache:'no-store'});
  if(!r.ok) throw new Error('Could not load verified progress. Please retry.');
  return (await r.json()).statuses;
}
/** The server recomputes raw answers. Local grades and self-review never become certificate evidence. */
export async function verifySavedAnswers(attempts: Attempt[]) {
  const latest=new Map<string,Attempt>();
  for(const a of [...attempts].sort((a,b)=>(a.submittedAt??'').localeCompare(b.submittedAt??'')))
    if(a.submittedAt && a.mode!=='review' && a.grade?.authoritative) latest.set(a.taskId,a);
  const answers=[...latest.values()].map(a=>({taskId:a.taskId,lessonVersion:a.lessonVersion,mode:a.mode,marks:a.marks,position:a.position,choice:a.choice,declaredNoFinding:a.declaredNoFinding,hintsUsed:a.hintsUsed,revealed:a.revealed}));
  let counted=0, rejected=0;
  for(let i=0;i<answers.length;i+=10) {
    const r=await fetch('/api/certificates/answers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:answers.slice(i,i+10)}),signal:AbortSignal.timeout(20000)});
    if(!r.ok) throw new Error('Your answers are saved on this device, but verification could not finish. Retry from Certificates.');
    const data=await r.json();
    counted+=data.results.filter((x:{counted?:boolean})=>x.counted).length;
    rejected+=data.results.filter((x:{ok:boolean})=>!x.ok).length;
  }
  return {counted,rejected};
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
