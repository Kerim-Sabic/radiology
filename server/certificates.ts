import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './store.js';
import type { Session } from './auth.js';
import { CERT_AREAS, CERT_TITLES, levelRule, type CertLevel } from '../shared/certificateLevels.js';
import { ISSUER, validCertificateId } from '../shared/credential.js';
import { verifiedProgress } from './certificateProgress.js';

export interface Certificate {
  id: string;
  name: string;
  area: string;
  level: CertLevel;
  title: string;
  patients: number;
  judged: number;
  accuracy: number;
  issuedAt: string;
  issuer?: string;
  verification?: 'server-graded' | 'legacy-self-reported';
  status?: 'active' | 'revoked';
  revokedAt?: string;
  requirements?: string;
}
const Claim = z
  .object({
    area: z.enum(CERT_AREAS),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    name: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[^\u0000-\u001f\u007f]+$/u),
    email: z.boolean().optional(),
    title: z.string().optional(),
    patients: z.number().optional(),
    judged: z.number().optional(),
    accuracy: z.number().optional(),
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
  if (!parsed.success) return { ok: false, error: 'That certificate request is not valid.' };
  const c = parsed.data;
  const slot = `rvm:cert-slot:${user.userId}:${c.area}:${c.level}`;
  const existing = await db().get<string>(slot);
  if (existing) {
    const certificate = await publicCertificate(existing);
    if (certificate) return { ok: true, certificate, emailRequested: c.email === true };
  }
  const result = (await verifiedProgress(user.userId)).find((s) => s.area === c.area && s.level === c.level);
  if (!result?.eligible)
    return {
      ok: false,
      error: result?.todo ?? 'Complete the server-graded requirements before claiming this certificate.',
    };
  const cert: Certificate = {
    id: newCertId(),
    name: c.name,
    area: c.area,
    level: c.level,
    title: CERT_TITLES[c.area],
    patients: result.read,
    judged: result.judged,
    accuracy: Math.round((result.accuracy ?? 0) * 1000) / 1000,
    issuedAt: new Date().toISOString(),
    issuer: ISSUER,
    verification: 'server-graded',
  };
  const rule = levelRule(c.area, c.level);
  cert.requirements = `${result.needPatients} distinct patients · ${result.needJudged} distinct graded tasks · ${Math.round(result.minAccuracy * 100)}% score${result.independent ? ' · Assess mode without hints or reveals' : ''}${rule.minAreas ? ` · at least ${rule.perArea} patients in each of ${rule.minAreas} areas` : ''}. Partial answers score one half. Latest answer per task counts.`;
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
