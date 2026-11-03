import { randomBytes } from 'node:crypto';
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
    join: await joinLink(professor),
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

/** Free places the class still has: the owner's number, minus students holding free access through the class. */
async function freePlacesLeft(professor: ProfessorRole, now = Date.now()) {
  if (professor.seats <= 0 || (professor.freeUntil && Date.parse(professor.freeUntil) <= now)) return 0;
  return Math.max(0, professor.seats - (await classGrants(professor.email, now)).length);
}

/** Put a student in the class; give free access through it if a place is left and they have none. Returns whether it did. */
async function enroll(professor: ProfessorRole, teacher: string, email: string, placeLeft: boolean, now: number) {
  await db().sadd(classKey(professor.email), email);
  await db().sadd(memberOfKey(email), professor.email);
  const existing = await grantFor(email);
  if (!placeLeft || (existing && grantActive(existing, now))) return false;
  await setGrant({ email, until: professor.freeUntil, note: `Class of ${teacher}`, by: professor.email, at: new Date(now).toISOString(), classOf: mailboxKey(professor.email) });
  return true;
}

/** The name the professor shows to students (from their account), kept for invitations and the student notice. */
export async function setTeacherName(professor: ProfessorRole, name: string) {
  const teacher = name.trim() || professor.email;
  await db().set(metaKey(professor.email), { name: teacher });
  return teacher;
}

/** Add students by email: their account is made if needed, and free access given while the class has free places. */
export async function addStudents(professor: ProfessorRole, teacherName: string, body: unknown, now = Date.now()) {
  const p = AddBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Enter up to 100 valid email addresses.' };
  const teacher = await setTeacherName(professor, teacherName);
  const current = new Set(await emailsOf(professor.email));
  const wanted = [...new Set(p.data.emails)].filter((e) => mailboxKey(e) !== mailboxKey(professor.email));
  const fresh = wanted.filter((e) => !current.has(e));
  if (current.size + fresh.length > MAX_STUDENTS) return { ok: false as const, error: `A class holds up to ${MAX_STUDENTS} students.` };
  let freeLeft = await freePlacesLeft(professor, now);
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
    const free = await enroll(professor, teacher, email, freeLeft > 0, now);
    if (free) freeLeft--;
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

// ---------------------------------------------------------------- join links
const joinKey = (professor: string) => `rvm:class-join:${mailboxKey(professor)}`;
const codeKey = (code: string) => `rvm:class-code:${code}`;
const CODE = /^[A-Za-z0-9_-]{10,24}$/;
const newCode = () => randomBytes(9).toString('base64url');
export interface JoinLink {
  code: string;
  /** False while the professor has turned joining off. */
  open: boolean;
}

/** The professor's class link, made the first time they need it. */
export async function joinLink(professor: ProfessorRole): Promise<JoinLink> {
  const found = await db().get<JoinLink>(joinKey(professor.email));
  if (found) return found;
  const link = { code: newCode(), open: true };
  await db().set(codeKey(link.code), professor.email);
  await db().set(joinKey(professor.email), link);
  return link;
}

/** A new link (the old one stops working at once), or joining turned off or on. Students already in the class stay. */
export async function changeJoinLink(professor: ProfessorRole, body: unknown) {
  const p = z.object({ action: z.enum(['new', 'close', 'open']) }).strict().safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Expected new, close or open.' };
  const link = await joinLink(professor);
  let next: JoinLink = { ...link, open: p.data.action !== 'close' };
  if (p.data.action === 'new') {
    await db().del(codeKey(link.code));
    next = { code: newCode(), open: true };
    await db().set(codeKey(next.code), professor.email);
  }
  await db().set(joinKey(professor.email), next);
  return { ok: true as const, join: next };
}

/** The class a link opens, while it works: its professor, and the name shown on the invitation. */
async function classFor(code: string) {
  if (!CODE.test(code)) return null;
  const email = await db().get<string>(codeKey(code));
  const professor = email ? await professorRole(email) : null;
  const link = professor ? await db().get<JoinLink>(joinKey(professor.email)) : null;
  if (!professor || !link || link.code !== code || !link.open) return null;
  const meta = await db().get<{ name?: string }>(metaKey(professor.email));
  return { professor, name: meta?.name || 'Your professor' };
}

/** The invitation anyone with the link sees (before signing up): whose class, and whether it includes free access. */
export async function invitation(code: string, now = Date.now()) {
  const c = await classFor(code);
  return c ? { name: c.name, free: (await freePlacesLeft(c.professor, now)) > 0 } : null;
}

/** A signed-in student joins with the link, after the app told them what the professor will see. */
export async function joinClass(student: string, body: unknown, now = Date.now()) {
  const p = z.object({ code: z.string().max(40) }).strict().safeParse(body);
  if (!p.success) return { ok: false as const, error: 'That join link is not valid.' };
  const c = await classFor(p.data.code);
  if (!c) return { ok: false as const, error: 'This join link does not work any more. Ask your professor for the current one.' };
  const email = student.trim().toLowerCase();
  if (mailboxKey(email) === mailboxKey(c.professor.email)) return { ok: false as const, error: 'This is your own class.' };
  const roster = await emailsOf(c.professor.email);
  if (roster.some((e) => mailboxKey(e) === mailboxKey(email))) return { ok: true as const, name: c.name, already: true, free: null };
  if (roster.length >= MAX_STUDENTS) return { ok: false as const, error: 'This class is full. Ask your professor.' };
  const free = await enroll(c.professor, c.name, email, (await freePlacesLeft(c.professor, now)) > 0, now);
  return { ok: true as const, name: c.name, already: false, free: free ? { until: c.professor.freeUntil } : null };
}

/** How many students a professor has, for the owner's view. */
export async function classSize(professor: string) {
  return (await emailsOf(professor)).length;
}
