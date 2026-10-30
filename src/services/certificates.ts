/**
 * Certificates: three levels for each body area and three for the whole library. Each level is an exam (the rules are
 * in shared/certificateLevels.ts, the exam itself in services/exam.ts) that the server grades; a pass it scored issues
 * the certificate, which the server keeps (name, result, date) behind a public check link.
 */
import type { CertExam } from './exam';
import { linkedinCredentialUrl, verificationUrl } from '../../shared/credential';
import {
  CERT_SKILLS,
  CERT_TITLES,
  EXAMS,
  LEVELS,
  credentialName,
  examRequirement,
  examRule,
  levelLabel,
  levelRequirement,
  type CertArea,
  type CertLevel,
} from '../../shared/certificateLevels';

export { CERT_TITLES, EXAMS, LEVELS, credentialName, examRequirement, examRule, levelLabel, levelRequirement };
export type { CertArea, CertLevel };

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
  /** The exam passed, with the rules it was taken under (certificates issued before the exams have none). */
  exam?: { questions: number; passMark: number; secondsPerQuestion?: number | null; partialCredit?: boolean };
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

/** Issue the certificate of an exam the server scored as passed, in the name given (and email it, if asked). */
export async function claimCertificate(exam: CertExam, name: string, email = false): Promise<{ ok: true; certificate: IssuedCertificate } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: exam.area, level: exam.level, name, email, examId: exam.id }),
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

/** A sample certificate for the example page (never stored, never checkable). */
export const EXAMPLE_CERTIFICATE: IssuedCertificate = {
  id: 'example',
  name: 'Your Name',
  area: 'chest',
  level: 2,
  title: CERT_TITLES.chest,
  patients: 25,
  judged: 25,
  accuracy: 0.88,
  issuedAt: new Date().toISOString(),
  exam: { questions: 25, passMark: 0.8, secondsPerQuestion: 180, partialCredit: true },
  verification: 'server-graded',
};
