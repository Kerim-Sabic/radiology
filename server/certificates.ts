import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './store.js';
import type { Session } from './auth.js';

/**
 * Certificates of completion. The app works out eligibility from the learner's own answers (they stay in the
 * browser), so a certificate records that practice as reported by the app; it is not a medical qualification.
 * Each has a public page with its details, so it can be shared and checked.
 */
export interface Certificate {
  id: string;
  name: string;
  area: string;
  title: string;
  patients: number;
  judged: number;
  accuracy: number;
  issuedAt: string;
}

const AREAS = ['chest', 'abdomen', 'head', 'msk', 'breast', 'all'] as const;
// The bar the app shows; the server refuses anything below it.
export const CERT_RULE = { minPatients: 10, minJudged: 10, minAccuracy: 0.7 };

const Claim = z
  .object({
    area: z.enum(AREAS),
    title: z.string().trim().min(3).max(80),
    name: z.string().trim().min(2).max(80),
    patients: z.number().int().min(0).max(100_000),
    judged: z.number().int().min(0).max(1_000_000),
    accuracy: z.number().min(0).max(1),
  })
  .strict();

const listKey = (userId: string) => `rvm:certs:${userId}`;
const certKey = (id: string) => `rvm:cert:${id}`;
export const newCertId = () => randomBytes(9).toString('base64url');

export async function myCertificates(user: Session): Promise<Certificate[]> {
  const ids = (await db().get<string[]>(listKey(user.userId))) ?? [];
  if (!ids.length) return [];
  const certs = (await db().mget<Certificate[]>(...ids.map(certKey))) as Array<Certificate | null>;
  return certs.filter((c): c is Certificate => !!c);
}

/** Issue (or renew, with the new numbers) the certificate for one area. */
export async function claimCertificate(user: Session, body: unknown): Promise<{ ok: true; certificate: Certificate } | { ok: false; error: string }> {
  const parsed = Claim.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'That certificate request is not valid.' };
  const c = parsed.data;
  if (c.patients < CERT_RULE.minPatients || c.judged < CERT_RULE.minJudged || c.accuracy < CERT_RULE.minAccuracy)
    return { ok: false, error: `A certificate needs ${CERT_RULE.minPatients} patients read and ${Math.round(CERT_RULE.minAccuracy * 100)}% of graded answers right.` };
  const mine = await myCertificates(user);
  const existing = mine.find((x) => x.area === c.area);
  const cert: Certificate = { id: existing?.id ?? newCertId(), name: c.name, area: c.area, title: c.title, patients: c.patients, judged: c.judged, accuracy: Math.round(c.accuracy * 1000) / 1000, issuedAt: new Date().toISOString() };
  await db().set(certKey(cert.id), cert);
  if (!existing) await db().set(listKey(user.userId), [...mine.map((x) => x.id), cert.id]);
  return { ok: true, certificate: cert };
}

/** Public check of a certificate by its id. */
export async function publicCertificate(id: string): Promise<Certificate | null> {
  if (!/^[\w-]{12}$/.test(id)) return null;
  return db().get<Certificate>(certKey(id));
}
