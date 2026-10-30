import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './store.js';
import type { Session } from './auth.js';
import { CERT_AREAS, CERT_TITLES, certRequirement, examRule, levelLabel, type CertLevel } from '../shared/certificateLevels.js';
import { ISSUER, validCertificateId } from '../shared/credential.js';
import { examFor } from './certificateExam.js';

/**
 * Certificates. Each level of each area is its own certificate, issued for an exam the server graded and scored as
 * passed: questions on real patients, each answer graded here against the expert's reference, without hints. The
 * levels are taken in order: a level is issued only to someone who holds the one below it. A certificate is issued
 * once and never changed afterwards (it can be revoked by an admin); it is not a medical qualification. Every
 * certificate has a public page so it can be shared and checked.
 */
export interface Certificate {
  id: string;
  name: string;
  area: string;
  level: CertLevel;
  title: string;
  /** Patients the exam's questions came from (for older certificates: patients read). */
  patients: number;
  /** Questions in the exam (older certificates: graded answers). */
  judged: number;
  /** Share right: correct 1, partly right ½ where the level gives half points. */
  accuracy: number;
  issuedAt: string;
  issuer?: string;
  verification?: 'server-graded' | 'legacy-self-reported';
  status?: 'active' | 'revoked';
  revokedAt?: string;
  requirements?: string;
  /** The exam passed, with the rules it was taken under. Older certificates have none. */
  exam?: { questions: number; passMark: number; secondsPerQuestion: number | null; partialCredit: boolean };
}
const Claim = z
  .object({
    area: z.enum(CERT_AREAS),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    name: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[^\u0000-\u001f\u007f]+$/u),
    email: z.boolean().optional(),
    examId: z.string().max(60),
  })
  .strict();
const certKey = (id: string) => `rvm:cert:${id}`;
export const newCertId = () => `RAD-${new Date().getUTCFullYear()}-${randomBytes(8).toString('hex').toUpperCase()}`;

export async function publicCertificate(id: string): Promise<Certificate | null> {
  if (!validCertificateId(id)) return null;
  const c = await db().get<Certificate>(certKey(id));
  if (!c) return null;
  const state = await db().get<{ status: 'revoked'; revokedAt: string }>(`rvm:cert-status:${id}`);
  return {
    ...c,
    level: c.level ?? 1,
    issuer: c.issuer ?? ISSUER,
    verification: c.verification ?? 'legacy-self-reported',
    status: state?.status ?? 'active',
    ...(state ? { revokedAt: state.revokedAt } : {}),
  };
}
export async function myCertificates(user: Session): Promise<Certificate[]> {
  const old = (await db().get<string[]>(`rvm:certs:${user.userId}`)) ?? [];
  const ids = [...new Set([...old, ...(await db().smembers<string[]>(`rvm:certs-v2:${user.userId}`))])];
  return (await Promise.all(ids.map(publicCertificate))).filter((c): c is Certificate => !!c);
}
export async function claimCertificate(user: Session, body: unknown): Promise<{ ok: true; certificate: Certificate; emailRequested?: boolean } | { ok: false; error: string }> {
  const parsed = Claim.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'That certificate request is not valid. Reload the page and try again.' };
  const c = parsed.data;
  const level = c.level as CertLevel;
  const slot = `rvm:cert-slot:${user.userId}:${c.area}:${level}`;
  const existing = await db().get<string>(slot);
  if (existing) {
    const certificate = await publicCertificate(existing);
    if (certificate) return { ok: true, certificate, emailRequested: c.email === true };
  }
  const exam = await examFor(user.userId, c.examId);
  if (!exam || exam.area !== c.area || exam.level !== level || !exam.finishedAt || !exam.result)
    return { ok: false, error: `${levelLabel(level)} is issued for an exam taken here: finish its exam first.` };
  if (!exam.result.passed) return { ok: false, error: `This exam was not passed: ${Math.round(exam.result.score * 100)}% against a pass mark of ${Math.round(examRule(c.area, level).passMark * 100)}%.` };
  if (level > 1 && !(await myCertificates(user)).some((x) => x.area === c.area && x.level === level - 1 && x.status !== 'revoked'))
    return { ok: false, error: `${levelLabel(level)} is issued after ${levelLabel((level - 1) as CertLevel)}: get that certificate first.` };
  const rule = examRule(c.area, level);
  const cert: Certificate = {
    id: newCertId(),
    name: c.name,
    area: c.area,
    level,
    title: CERT_TITLES[c.area],
    patients: exam.result.patients,
    judged: exam.result.questions,
    accuracy: Math.round(exam.result.score * 1000) / 1000,
    issuedAt: new Date().toISOString(),
    issuer: ISSUER,
    verification: 'server-graded',
    exam: { questions: exam.result.questions, passMark: rule.passMark, secondsPerQuestion: rule.secondsPerQuestion, partialCredit: rule.partialCredit },
  };
  cert.requirements = `${certRequirement(cert)}.`;
  // One atomic issuance per user/area/level. Later claims cannot rename, renew or overwrite it.
  const id = (await db().eval(
    `local old=redis.call('GET',KEYS[1]); if old then return old end; if redis.call('EXISTS',KEYS[2])==1 then return '' end; redis.call('SET',KEYS[2],ARGV[2]); redis.call('SET',KEYS[1],ARGV[1]); redis.call('SADD',KEYS[3],ARGV[1]); return ARGV[1]`,
    [slot, certKey(cert.id), `rvm:certs-v2:${user.userId}`],
    [cert.id, JSON.stringify(cert)],
  )) as string;
  if (!id) return { ok: false, error: 'Please retry issuing your certificate.' };
  const certificate = await publicCertificate(id);
  if (!certificate) throw new Error('Certificate could not be read after issuance');
  return { ok: true, certificate, emailRequested: c.email === true };
}
export async function revokeCertificate(adminId: string, body: unknown) {
  const p = z
    .object({ id: z.string(), reason: z.string().trim().min(5).max(500) })
    .strict()
    .safeParse(body);
  if (!p.success || !(await publicCertificate(p.data.id))) return { ok: false, error: 'Enter a valid credential ID and a reason.' };
  const state = {
    status: 'revoked',
    revokedAt: new Date().toISOString(),
    adminId,
    reason: p.data.reason,
  };
  await db().set(`rvm:cert-status:${p.data.id}`, state, { nx: true });
  return { ok: true, certificate: await publicCertificate(p.data.id) };
}
