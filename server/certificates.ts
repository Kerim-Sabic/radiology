import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './store.js';
import type { Session } from './auth.js';
import { CERT_AREAS, CERT_TITLES, PATIENT_FLOOR, levelLabel, levelRule, type CertLevel } from '../shared/certificateLevels.js';

/**
 * Certificates of completion. The app works out eligibility from the learner's own answers (they stay in the
 * browser), so a certificate records that practice as reported by the app; it is not a medical qualification.
 * Each level of each area is its own certificate, with a public page so it can be shared and checked.
 */
export interface Certificate {
  id: string;
  name: string;
  area: string;
  /** Certificates issued before levels existed are level 1. */
  level: CertLevel;
  title: string;
  patients: number;
  judged: number;
  accuracy: number;
  issuedAt: string;
}

const Claim = z
  .object({
    area: z.enum(CERT_AREAS),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    // Older clients send the title; the server names the certificate itself.
    title: z.string().max(80).optional(),
    name: z.string().trim().min(2).max(80),
    patients: z.number().int().min(0).max(100_000),
    judged: z.number().int().min(0).max(1_000_000),
    accuracy: z.number().min(0).max(1),
  })
  .strict();

const listKey = (userId: string) => `rvm:certs:${userId}`;
const certKey = (id: string) => `rvm:cert:${id}`;
export const newCertId = () => randomBytes(9).toString('base64url');

const withLevel = (c: Certificate): Certificate => ({ ...c, level: c.level ?? 1 });

export async function myCertificates(user: Session): Promise<Certificate[]> {
  const ids = (await db().get<string[]>(listKey(user.userId))) ?? [];
  if (!ids.length) return [];
  const certs = (await db().mget<Certificate[]>(...ids.map(certKey))) as Array<Certificate | null>;
  return certs.filter((c): c is Certificate => !!c).map(withLevel);
}

/** Issue (or renew, with the new numbers) the certificate for one level of one area. */
export async function claimCertificate(user: Session, body: unknown): Promise<{ ok: true; certificate: Certificate } | { ok: false; error: string }> {
  const parsed = Claim.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'That certificate request is not valid.' };
  const c = parsed.data;
  const level = c.level as CertLevel;
  const rule = levelRule(c.area, level);
  // The app asks for every patient of a smaller area, which the server cannot see; it checks the least any level asks.
  const minPatients = c.area === 'all' ? rule.minPatients : PATIENT_FLOOR;
  if (c.patients < minPatients || c.judged < rule.minJudged || c.accuracy < rule.minAccuracy)
    return { ok: false, error: `${levelLabel(level)} needs ${rule.minJudged} graded answers${rule.independent ? ' without hints' : ''} with ${Math.round(rule.minAccuracy * 100)}% right.` };
  const mine = await myCertificates(user);
  const existing = mine.find((x) => x.area === c.area && x.level === level);
  const cert: Certificate = {
    id: existing?.id ?? newCertId(),
    name: c.name,
    area: c.area,
    level,
    title: CERT_TITLES[c.area],
    patients: c.patients,
    judged: c.judged,
    accuracy: Math.round(c.accuracy * 1000) / 1000,
    issuedAt: new Date().toISOString(),
  };
  await db().set(certKey(cert.id), cert);
  if (!existing) await db().set(listKey(user.userId), [...mine.map((x) => x.id), cert.id]);
  return { ok: true, certificate: cert };
}

/** Public check of a certificate by its id. */
export async function publicCertificate(id: string): Promise<Certificate | null> {
  if (!/^[\w-]{12}$/.test(id)) return null;
  const c = await db().get<Certificate>(certKey(id));
  return c ? withLevel(c) : null;
}
