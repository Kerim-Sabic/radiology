/**
 * Certificates of completion, worked out from your own answers: one per body area, and "Radiology foundations"
 * across the areas. The server keeps the issued certificate (name, numbers, date) behind a public check link.
 */
import type { AreaProgress } from './areas';
import type { Attempt } from './progressRepository';

export const CERT_BAR = { minPatients: 10, minJudged: 10, minAccuracy: 0.7 };
export const FOUNDATIONS_BAR = { minPatients: 40, minJudged: 40, minAccuracy: 0.7, minAreas: 3, perArea: 3 };

export const CERT_TITLES: Record<string, string> = {
  chest: 'Chest imaging',
  abdomen: 'Abdominal and pelvic imaging',
  head: 'Neuroimaging',
  msk: 'Musculoskeletal imaging',
  breast: 'Breast imaging',
  all: 'Radiology foundations',
};

export interface CertStatus {
  area: string;
  title: string;
  patients: number;
  read: number;
  judged: number;
  accuracy: number | null;
  /** Patients needed (never more than the area has). */
  needPatients: number;
  eligible: boolean;
  /** 0..1 towards the bar. */
  progress: number;
  /** What is still missing, in words. */
  todo: string | null;
}

const outcome = (a: Attempt) => a.grade?.outcome ?? a.selfReview?.verdict ?? null;

function status(area: string, read: number, patients: number, judged: number, accuracy: number | null, bar: { minPatients: number; minJudged: number; minAccuracy: number }, extra: string | null = null): CertStatus {
  const needPatients = bar.minPatients;
  const okAcc = accuracy !== null && accuracy >= bar.minAccuracy;
  const eligible = patients >= needPatients && read >= needPatients && judged >= bar.minJudged && okAcc && !extra;
  const todo = eligible
    ? null
    : patients < needPatients
      ? `More patients in this area are on the way (${patients} so far; ${needPatients} needed).`
      : read < needPatients
        ? `Read ${needPatients - read} more patient${needPatients - read === 1 ? '' : 's'}.`
        : judged < bar.minJudged
          ? `Answer ${bar.minJudged - judged} more graded task${bar.minJudged - judged === 1 ? '' : 's'}.`
          : !okAcc
            ? `Get to ${Math.round(bar.minAccuracy * 100)}% right (now ${Math.round((accuracy ?? 0) * 100)}%): retry your mistakes.`
            : extra;
  const progress = Math.min(1, (Math.min(read, needPatients) / needPatients) * 0.5 + (Math.min(judged, bar.minJudged) / bar.minJudged) * 0.25 + (okAcc ? 0.25 : ((accuracy ?? 0) / bar.minAccuracy) * 0.25));
  return { area, title: CERT_TITLES[area] ?? area, patients, read, judged, accuracy, needPatients, eligible, progress: eligible ? 1 : Math.min(progress, 0.99), todo };
}

export function certificateStatus(areas: AreaProgress[], attempts: Attempt[]): CertStatus[] {
  const list = areas.map((a) => status(a.id, a.read, a.patients, a.judged, a.accuracy, CERT_BAR));
  // Foundations: across every area, with real breadth.
  const done = attempts.filter((a) => a.submittedAt);
  const judged = done.filter((a) => ['correct', 'partial', 'incorrect'].includes(outcome(a) ?? ''));
  const points = judged.reduce((s, a) => s + (outcome(a) === 'correct' ? 1 : outcome(a) === 'partial' ? 0.5 : 0), 0);
  const read = new Set(done.map((a) => a.holdoutGroup)).size;
  const patients = areas.reduce((s, a) => s + a.patients, 0);
  const wide = areas.filter((a) => a.read >= FOUNDATIONS_BAR.perArea).length;
  const breadth = wide < FOUNDATIONS_BAR.minAreas ? `Read at least ${FOUNDATIONS_BAR.perArea} patients in ${FOUNDATIONS_BAR.minAreas} body areas (${wide} so far).` : null;
  list.push(status('all', read, patients, judged.length, judged.length ? points / judged.length : null, FOUNDATIONS_BAR, breadth));
  return list;
}

export interface IssuedCertificate {
  id: string;
  name: string;
  area: string;
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
      body: JSON.stringify({ area: s.area, title: s.title, name, patients: s.read, judged: s.judged, accuracy: s.accuracy ?? 0 }),
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
    name: `${c.title} certificate`,
    organization: 'radiology.monster',
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
