import type { User } from '@clerk/backend';
import { z } from 'zod';
import { accountMail, clerk, ensureAccount, longDate, sendAccountMail, SIGN_IN_STEPS } from './accounts.js';
import { hash } from './auth.js';
import { db } from './store.js';
import { mailboxKey } from './mailbox.js';
import { allGrants, grantActive, grantFor, removeGrant, setGrant } from './grants.js';
import { professorRole, type ProfessorRole } from './roles.js';
import { publicCertificate } from './certificates.js';
import { lastExamKey } from './certificateExam.js';
import { CERT_AREAS, credentialName, type CertArea, type CertLevel } from '../shared/certificateLevels.js';
import type { Profile } from './engage.js';

/**
 * A professor's class: the students they added by email. The professor sees each student's study days, exam results
 * and certificates (never payments). Students are told who can see this and can leave the class themselves. Free
 * access the owner allowed a professor to give is marked with the class, and ends when the student leaves the class.
 */

export const MAX_STUDENTS = 500;
const classKey = (professor: string) => `rvm:class:${mailboxKey(professor)}`;
const metaKey = (professor: string) => `rvm:class-meta:${mailboxKey(professor)}`;
const memberOfKey = (student: string) => `rvm:classes-of:${mailboxKey(student)}`;
const DAY_MS = 86_400_000;
const LEVELS: CertLevel[] = [1, 2, 3];

export interface ClassStudent {
  email: string;
  name: string;
  /** Whether the student has an account yet. */
  account: boolean;
  lastActiveAt: string | null;
  /** Days with study in the last 7 and 30 days, and the last one. */
  days7: number;
  days30: number;
  lastStudied: string | null;
  exams: Array<{ area: CertArea; level: CertLevel; passed: boolean; score: number | null; finishedAt: string }>;
  certificates: Array<{ id: string; title: string; issuedAt: string; revoked: boolean }>;
  /** Free access given through this class, or null. */
  freeFromClass: { until: string | null } | null;
}

async function emailsOf(professor: string): Promise<string[]> {
  return ((await db().smembers(classKey(professor))) as string[]).sort();
}

/** Free access given through this professor's class, still running. */
async function classGrants(professor: string, now = Date.now()) {
  return (await allGrants()).filter((g) => g.classOf === mailboxKey(professor) && grantActive(g, now));
}

/** The classes a student is in (only professors who still have the role), with the name their professor shows. */
export async function classesOf(student: string): Promise<Array<{ email: string; name: string }>> {
  const professors = (await db().smembers(memberOfKey(student))) as string[];
  const out: Array<{ email: string; name: string }> = [];
  for (const email of professors) {
    if (!(await professorRole(email))) continue;
    const meta = await db().get<{ name?: string }>(metaKey(email));
    out.push({ email, name: meta?.name || email });
  }
  return out;
}

/** Everything the professor's page shows: the roster with each student's study, exams and certificates. */
export async function classRoster(professor: ProfessorRole, now = Date.now()) {
  const emails = await emailsOf(professor.email);
  const users = new Map<string, User>();
  for (let i = 0; i < emails.length; i += 100) {
    const page = await clerk().users.getUserList({ emailAddress: emails.slice(i, i + 100), limit: 100 });
    for (const u of page.data) for (const e of u.emailAddresses) users.set(e.emailAddress.trim().toLowerCase(), u);
  }
  const grants = new Map((await allGrants()).map((g) => [mailboxKey(g.email), g]));
  const examKeys = (id: string) => CERT_AREAS.flatMap((area) => LEVELS.map((level) => lastExamKey(id, area, level)));
  const students: ClassStudent[] = [];
  // A few students at a time: each needs its profile, 18 exam results and its certificates.
  for (let i = 0; i < emails.length; i += 20) {
    students.push(
      ...(await Promise.all(
        emails.slice(i, i + 20).map(async (email): Promise<ClassStudent> => {
          const u = users.get(email);
          const g = grants.get(mailboxKey(email));
          const freeFromClass = g && g.classOf === mailboxKey(professor.email) && grantActive(g, now) ? { until: g.until } : null;
          if (!u) return { email, name: '', account: false, lastActiveAt: null, days7: 0, days30: 0, lastStudied: null, exams: [], certificates: [], freeFromClass };
          const id = hash(`clerk:${u.id}`);
          const [profile, ...last] = (await db().mget<unknown[]>(`rvm:profile:${id}`, ...examKeys(id))) as [Profile | null, ...Array<{ finishedAt: string; passed: boolean; score?: number } | null>];
          const exams = CERT_AREAS.flatMap((area, a) =>
            LEVELS.flatMap((level, l) => {
              const r = last[a * LEVELS.length + l];
              return r ? [{ area, level, passed: r.passed, score: typeof r.score === 'number' ? r.score : null, finishedAt: r.finishedAt }] : [];
            }),
          );
          const ids = [...new Set([...((await db().get<string[]>(`rvm:certs:${id}`)) ?? []), ...((await db().smembers(`rvm:certs-v2:${id}`)) as string[])])];
          const certificates = (await Promise.all(ids.map(publicCertificate)))
            .filter((c) => !!c)
            .map((c) => ({ id: c!.id, title: credentialName(c!.title, c!.level), issuedAt: c!.issuedAt, revoked: c!.status === 'revoked' }));
          const days = profile?.days ?? [];
          const since = (n: number) => days.filter((d) => now - Date.parse(`${d}T23:59:59Z`) < n * DAY_MS).length;
          return {
            email,
            name: [u.firstName, u.lastName].filter(Boolean).join(' '),
            account: true,
            lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : null,
            days7: since(7),
            days30: since(30),
            lastStudied: days.at(-1) ?? null,
            exams,
            certificates,
            freeFromClass,
          };
        }),
      )),
    );
  }
  const used = students.filter((s) => s.freeFromClass).length;
  return {
    free: { seats: professor.seats, used, left: Math.max(0, professor.seats - used), until: professor.freeUntil, open: professor.seats > 0 && (!professor.freeUntil || Date.parse(professor.freeUntil) > now) },
    summary: {
      students: students.length,
      signedUp: students.filter((s) => s.account).length,
      active7: students.filter((s) => s.days7 > 0).length,
      examsPassed: students.reduce((n, s) => n + s.exams.filter((e) => e.passed).length, 0),
      certificates: students.reduce((n, s) => n + s.certificates.filter((c) => !c.revoked).length, 0),
    },
    students,
  };
}

const Emails = z.array(z.string().trim().toLowerCase().max(254).email()).min(1).max(100);
const AddBody = z.object({ emails: Emails, sendEmail: z.boolean() }).strict();
const EmailBody = z.object({ email: z.string().trim().toLowerCase().max(254).email() }).strict();

function classMail(student: string, teacher: string, free: { until: string | null } | null) {
  const lines = [
    `${teacher} added you to their class on radiology.monster, where you read real CT, MRI, X-ray, mammography and ultrasound cases and get graded on the exact slice.`,
    ...(free ? [free.until ? `Your class gives you free access to everything until ${longDate(free.until)}.` : 'Your class gives you free access to everything.'] : []),
    `${teacher} can see your study days, exam results and certificates. You can leave the class at any time in Settings.`,
    `Your account is ${student}. ${SIGN_IN_STEPS}`,
  ];
  return accountMail(`You are in ${teacher}’s class on radiology.monster`, lines, 'You get this email because your professor added you to their class. For education only, not for clinical diagnosis.');
}

/** Add students by email: their account is made if needed, and free access given while the class has free places. */
export async function addStudents(professor: ProfessorRole, teacherName: string, body: unknown, now = Date.now()) {
  const p = AddBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Enter up to 100 valid email addresses.' };
  const teacher = teacherName.trim() || professor.email;
  await db().set(metaKey(professor.email), { name: teacher });
  const current = new Set(await emailsOf(professor.email));
  const wanted = [...new Set(p.data.emails)].filter((e) => mailboxKey(e) !== mailboxKey(professor.email));
  const fresh = wanted.filter((e) => !current.has(e));
  if (current.size + fresh.length > MAX_STUDENTS) return { ok: false as const, error: `A class holds up to ${MAX_STUDENTS} students.` };
  let freeLeft = professor.seats > 0 && (!professor.freeUntil || Date.parse(professor.freeUntil) > now) ? Math.max(0, professor.seats - (await classGrants(professor.email, now)).length) : 0;
  const results: Array<{ email: string; added: boolean; created?: boolean; free?: boolean; emailed?: boolean; note?: string }> = [];
  for (const email of wanted) {
    if (current.has(email)) {
      results.push({ email, added: false, note: 'already in your class' });
      continue;
    }
    const account = await ensureAccount(email);
    if (!account.ok) {
      results.push({ email, added: false, note: account.error });
      continue;
    }
    await db().sadd(classKey(professor.email), email);
    await db().sadd(memberOfKey(email), professor.email);
    const existing = await grantFor(email);
    let free = false;
    if (freeLeft > 0 && !(existing && grantActive(existing, now))) {
      await setGrant({ email, until: professor.freeUntil, note: `Class of ${teacher}`, by: professor.email, at: new Date(now).toISOString(), classOf: mailboxKey(professor.email) });
      freeLeft--;
      free = true;
    }
    const emailed = p.data.sendEmail ? await sendAccountMail(email, classMail(email, teacher, free ? { until: professor.freeUntil } : null)) : false;
    results.push({ email, added: true, created: account.created, free, emailed });
  }
  return { ok: true as const, results, freeLeft };
}

/** Take a student out of a class (their roster entry, however the address was written); class free access ends with it. */
async function leave(professor: string, student: string) {
  for (const entry of await emailsOf(professor)) if (mailboxKey(entry) === mailboxKey(student)) await db().srem(classKey(professor), entry);
  await db().srem(memberOfKey(student), professor);
  const g = await grantFor(student);
  if (g?.classOf === mailboxKey(professor)) await removeGrant(student);
}

export async function removeStudent(professor: ProfessorRole, body: unknown) {
  const p = EmailBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Enter a valid email address.' };
  if (!(await emailsOf(professor.email)).some((e) => mailboxKey(e) === mailboxKey(p.data.email))) return { ok: false as const, error: 'That student is not in your class.' };
  await leave(professor.email, p.data.email);
  return { ok: true as const };
}

/** A student leaves a class themselves. */
export async function leaveClass(student: string, body: unknown) {
  const p = z.object({ professor: z.string().trim().toLowerCase().max(254).email() }).strict().safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Which class?' };
  const professors = (await db().smembers(memberOfKey(student))) as string[];
  if (!professors.includes(p.data.professor)) return { ok: false as const, error: 'You are not in that class.' };
  await leave(p.data.professor, student);
  return { ok: true as const };
}

/** The professor role of a signed-in account with a verified email, or null. */
export async function professorFor(userId: string): Promise<ProfessorRole | null> {
  const identity = await db().get<{ email: string; emailVerified: boolean }>(`rvm:identity:${userId}`);
  return identity?.emailVerified === true ? professorRole(identity.email) : null;
}

/** When the owner removes a professor's role, the free access their class gave ends (the roster stays, hidden). */
export async function endClassAccess(professor: string) {
  for (const g of await classGrants(professor)) await removeGrant(g.email);
}

/** When the owner changes a professor's end date, the free access their class gave follows it. */
export async function syncClassAccess(professor: string, until: string | null) {
  for (const g of await classGrants(professor)) await setGrant({ ...g, until });
}

/** How many students a professor has, for the owner's view. */
export async function classSize(professor: string) {
  return (await emailsOf(professor)).length;
}
