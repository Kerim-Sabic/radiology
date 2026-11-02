import { createClerkClient, type User } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import { z } from 'zod';
import { appOrigin, membershipPlans, readiness, required, type AccessTier } from './config.js';
import { db, rateLimit } from './store.js';
import { hash, isAdminEmail, isOwnerEmail, type AdminAccess } from './auth.js';
import { mailboxKey } from './mailbox.js';
import { allGrants, grantActive, grantFor, removeGrant, setGrant, type Grant } from './grants.js';
import { allAdminRoles, PERMISSIONS, removeAdminRole, setAdminRole, type Permission } from './roles.js';
import { membershipAccess, whop } from './billing.js';
import type { Profile } from './engage.js';

/**
 * The admin dashboard: every account with its access and study, exact counts, and creating an account (a Clerk user
 * for an email; this instance signs in with an emailed code, so no password is set) with free access.
 */

export interface Person {
  email: string;
  name: string;
  /** Where the account lives: Clerk, an older Whop sign-in, or none yet (free access waiting for a first sign-in). */
  account: 'clerk' | 'whop' | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  /** First sign-in to the app (YYYY-MM-DD). */
  firstVisit: string | null;
  lastStudied: string | null;
  studyDays: number;
  /** `member`: has paid access, shown so to admins who may not see payments. */
  access: 'admin' | 'paid' | 'member' | 'free' | 'none';
  /** Admin or user; an admin's role comes from ADMIN_EMAILS in Vercel or from the dashboard. */
  role: 'admin' | 'user';
  /** For the owner only: where an admin's role comes from, and what they may do. Others see every admin alike. */
  adminSource?: 'owner' | 'vercel' | 'dashboard';
  permissions?: Permission[];
  plan?: AccessTier;
  paidUntil?: string | null;
  grant?: { until: string | null; note?: string; by: string; at: string; active: boolean };
}

const clerk = () => createClerkClient({ secretKey: required('CLERK_SECRET_KEY') });
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
const DAY_MS = 86_400_000;

async function clerkUsers(): Promise<{ users: User[]; total: number }> {
  const users: User[] = [];
  let total = 0;
  for (let offset = 0; offset < 50_000; offset += 500) {
    const page = await clerk().users.getUserList({ limit: 500, offset, orderBy: '-created_at' });
    users.push(...page.data);
    total = page.totalCount;
    if (page.data.length < 500) break;
  }
  return { users, total };
}

/** Active Whop memberships of this product: plan and paid-until by Whop user, and each one's email. Null if Whop cannot be read. */
async function payingMembers() {
  if (!readiness().billing) return null;
  try {
    const client = await whop();
    const account = required('WHOP_ACCOUNT_ID');
    const product = required('WHOP_PRODUCT_ID');
    const paid = new Map<string, { tier: AccessTier; until: string | null }>();
    const list = await client.memberships.list({ account_id: account, product_ids: [product], plan_ids: membershipPlans().map((p) => p.id), statuses: ['active', 'completed'], first: 100 });
    for await (const m of list) {
      if (!m.user_id || m.product_id !== product) continue;
      const a = membershipAccess(m);
      if (a.active && paid.get(m.user_id)?.tier !== 'lifetime') paid.set(m.user_id, { tier: a.tier!, until: a.expiresAt ?? null });
    }
    const emails = new Map<string, string>();
    const ids = [...paid.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      const members = await client.members.list({ account_id: account, user_ids: ids.slice(i, i + 50), first: 100 });
      for await (const member of members) if (member.account_id === account && member.user?.id && member.email) emails.set(member.user.id, member.email.trim().toLowerCase());
    }
    return { paid, emails };
  } catch {
    console.error('Admin: Whop memberships could not be read');
    return null;
  }
}

/** The dashboard's people, shown as `viewer` may see them (payments only with that permission; roles in full only to the owner). */
export async function adminPeople(viewer: AdminAccess, now = Date.now()) {
  const full = await everyone(now);
  const payments = viewer.permissions.includes('payments');
  const people = full.people.map((p): Person => {
    const out = { ...p };
    if (!payments && out.access === 'paid') out.access = 'member';
    if (!payments) delete out.plan, delete out.paidUntil;
    if (!viewer.owner) delete out.adminSource, delete out.permissions;
    return out;
  });
  const counts = payments ? full.counts : { ...full.counts, paying: null, payingWithoutAccount: null, plans: null };
  return { counts, whop: payments ? full.whop : 'hidden', people };
}

async function everyone(now: number) {
  const [{ users, total }, appUsers, grants, roles, whopPaid] = await Promise.all([clerkUsers(), db().smembers('rvm:users') as Promise<string[]>, allGrants(), allAdminRoles(), payingMembers()]);
  const roleBy = new Map(roles.map((r) => [mailboxKey(r.email), r]));
  const adminSource = (email: string): Person['adminSource'] => (isOwnerEmail(email) ? 'owner' : isAdminEmail(email) ? 'vercel' : roleBy.has(mailboxKey(email)) ? 'dashboard' : undefined);
  const roleFields = (email: string, source: Person['adminSource']) =>
    source ? { adminSource: source, permissions: source === 'dashboard' ? roleBy.get(mailboxKey(email))!.permissions : [...PERMISSIONS] } : {};

  // Accounts by app user id (the hash of the Clerk id), so the app's own records join without a lookup.
  const accounts = new Map<string, Pick<Person, 'email' | 'name' | 'account' | 'createdAt' | 'lastActiveAt'>>();
  for (const u of users) {
    const email = (u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0])?.emailAddress;
    accounts.set(hash(`clerk:${u.id}`), { email: email?.trim().toLowerCase() ?? '', name: [u.firstName, u.lastName].filter(Boolean).join(' '), account: 'clerk', createdAt: iso(u.createdAt), lastActiveAt: iso(u.lastActiveAt ?? u.lastSignInAt) });
  }
  const ids = [...new Set([...accounts.keys(), ...appUsers])];
  const records = new Map<string, { identity: { email: string; provider?: string } | null; joined: string | null; profile: Profile | null; whopUser: string | null }>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const values = (await db().mget<unknown[]>(...chunk.flatMap((id) => [`rvm:identity:${id}`, `rvm:once:signup:${id}`, `rvm:profile:${id}`, `rvm:whop-user:${id}`]))) as unknown[];
    chunk.forEach((id, j) => {
      const [identity, joined, profile, whopUser] = values.slice(j * 4, j * 4 + 4) as [{ email: string; provider?: string } | null, string | null, Profile | null, string | null];
      records.set(id, { identity, joined, profile, whopUser });
    });
  }

  const grantBy = new Map(grants.map((g) => [mailboxKey(g.email), g]));
  const paidByMailbox = new Map<string, { tier: AccessTier; until: string | null }>();
  for (const [whopUser, p] of whopPaid?.paid ?? []) {
    const email = whopPaid!.emails.get(whopUser);
    if (email) paidByMailbox.set(mailboxKey(email), p);
  }

  const people: Person[] = [];
  const seenMailboxes = new Set<string>();
  const seenWhopUsers = new Set<string>();
  for (const id of ids) {
    const r = records.get(id)!;
    const a = accounts.get(id);
    // Sign-ins kept in the app only: older Whop sign-ins. A Clerk sign-in whose Clerk account is gone is not an account.
    if (!a && r.identity?.provider !== 'whop') continue;
    const email = a?.email || r.identity?.email?.trim().toLowerCase() || '';
    if (!email) continue;
    const key = mailboxKey(email);
    seenMailboxes.add(key);
    const paid = (r.whopUser ? whopPaid?.paid.get(r.whopUser) : undefined) ?? paidByMailbox.get(key);
    if (r.whopUser && whopPaid?.paid.has(r.whopUser)) seenWhopUsers.add(r.whopUser);
    const g = grantBy.get(key);
    const days = r.profile?.days ?? [];
    const source = adminSource(email);
    people.push({
      email,
      name: a?.name || r.profile?.name || '',
      account: a ? 'clerk' : 'whop',
      createdAt: a?.createdAt ?? (r.joined ? `${r.joined}T00:00:00.000Z` : null),
      lastActiveAt: a?.lastActiveAt ?? null,
      firstVisit: r.joined,
      lastStudied: days.at(-1) ?? null,
      studyDays: days.length,
      access: source ? 'admin' : paid ? 'paid' : g && grantActive(g, now) ? 'free' : 'none',
      role: source ? 'admin' : 'user',
      ...roleFields(email, source),
      ...(paid ? { plan: paid.tier, paidUntil: paid.until } : {}),
      ...(g ? { grant: { until: g.until, note: g.note, by: g.by, at: g.at, active: grantActive(g, now) } } : {}),
    });
  }
  // Free access or an admin role given to an email that has no account yet.
  const listed = new Set(seenMailboxes);
  for (const email of [...grants.map((g) => g.email), ...roles.map((r) => r.email)]) {
    const key = mailboxKey(email);
    if (listed.has(key)) continue;
    listed.add(key);
    const g = grantBy.get(key);
    const source = adminSource(email);
    people.push({
      email, name: '', account: null, createdAt: null, lastActiveAt: null, firstVisit: null, lastStudied: null, studyDays: 0,
      access: source ? 'admin' : g && grantActive(g, now) ? 'free' : 'none',
      role: source ? 'admin' : 'user',
      ...roleFields(email, source),
      ...(g ? { grant: { until: g.until, note: g.note, by: g.by, at: g.at, active: grantActive(g, now) } } : {}),
    });
  }
  people.sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''));

  const within = (value: string | null, days: number) => !!value && now - Date.parse(value.length === 10 ? `${value}T23:59:59Z` : value) < days * DAY_MS;
  const plans = { monthly: 0, yearly: 0, lifetime: 0 };
  for (const p of whopPaid?.paid.values() ?? []) plans[p.tier]++;
  const withAccount = people.filter((p) => p.account);
  return {
    counts: {
      accounts: withAccount.length,
      clerkAccounts: total,
      openedApp: withAccount.filter((p) => p.firstVisit).length,
      paying: whopPaid ? whopPaid.paid.size : null,
      // Paying on Whop under an email that has no account here (they bought on Whop and never signed in).
      payingWithoutAccount: whopPaid ? [...whopPaid.paid.keys()].filter((u) => !seenWhopUsers.has(u) && !seenMailboxes.has(mailboxKey(whopPaid.emails.get(u) ?? ''))).length : null,
      plans,
      free: grants.filter((g) => grantActive(g, now)).length,
      freeWaiting: people.filter((p) => !p.account && p.access === 'free').length,
      admins: people.filter((p) => p.access === 'admin').length,
      newAccounts: { d1: withAccount.filter((p) => within(p.createdAt, 1)).length, d7: withAccount.filter((p) => within(p.createdAt, 7)).length, d30: withAccount.filter((p) => within(p.createdAt, 30)).length },
      active: { d7: withAccount.filter((p) => within(p.lastActiveAt, 7)).length, d30: withAccount.filter((p) => within(p.lastActiveAt, 30)).length },
      studied: { d7: withAccount.filter((p) => within(p.lastStudied, 7)).length, d30: withAccount.filter((p) => within(p.lastStudied, 30)).length },
    },
    whop: whopPaid ? 'ok' : readiness().billing ? 'unavailable' : 'off',
    people,
  };
}

// ---------------------------------------------------------------- creating accounts and free access
const Email = z.string().trim().toLowerCase().max(254).email();
/** A last day (YYYY-MM-DD, free access ends after it), or null for no end date. */
const FreeUntil = z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const Note = z.string().trim().max(200);
const AddBody = z.object({ email: Email, name: z.string().trim().max(100).optional(), freeUntil: FreeUntil.optional(), note: Note.optional(), sendEmail: z.boolean() }).strict();
const GrantBody = z.object({ email: Email, freeUntil: FreeUntil, note: Note.optional() }).strict();
const EmailBody = z.object({ email: Email }).strict();

/** The end of the free access: the end of that day (UTC); null for no end date; undefined if not a future date. */
function endOf(day: string | null, now = Date.now()): string | null | undefined {
  if (day === null) return null;
  const t = Date.parse(`${day}T23:59:59.999Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day || t <= now || t > now + 50 * 365 * DAY_MS) return undefined;
  return new Date(t).toISOString();
}

const clerkError = (e: unknown) => (isClerkAPIResponseError(e) && e.errors[0] ? e.errors[0].longMessage || e.errors[0].message : 'Clerk could not create this account. Please try again.');

async function giveFree(email: string, until: string | null, note: string | undefined, admin: string): Promise<Grant> {
  const existing = await grantFor(email);
  const grant: Grant = { email, until, ...((note ?? existing?.note) ? { note: note ?? existing?.note } : {}), by: admin, at: new Date().toISOString() };
  await setGrant(grant);
  return grant;
}

/** Create the account for an email (or find it), optionally give free access, and optionally email the sign-in steps. */
export async function addPerson(admin: string, body: unknown) {
  const p = AddBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Enter a valid email address.' };
  const until = p.data.freeUntil === undefined ? undefined : endOf(p.data.freeUntil);
  if (p.data.freeUntil !== undefined && until === undefined) return { ok: false as const, error: 'Choose a free-access end date in the future.' };
  const { email, name } = p.data;
  const found = await clerk().users.getUserList({ emailAddress: [email], limit: 1 });
  let created = false;
  if (!found.data.length) {
    const [firstName, ...rest] = (name ?? '').split(/\s+/).filter(Boolean);
    try {
      await clerk().users.createUser({ emailAddress: [email], ...(firstName ? { firstName } : {}), ...(rest.length ? { lastName: rest.join(' ') } : {}), skipPasswordRequirement: true });
      created = true;
    } catch (e) {
      return { ok: false as const, error: clerkError(e) };
    }
  }
  const grant = until === undefined ? null : await giveFree(email, until, p.data.note, admin);
  const emailed = p.data.sendEmail ? await sendWelcome(email, name || found.data[0]?.firstName || undefined, grant ?? (await grantFor(email))) : false;
  return { ok: true as const, created, grant, emailed };
}

export async function setFreeAccess(admin: string, body: unknown) {
  const p = GrantBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Expected an email address and an end date (or no end date).' };
  const until = endOf(p.data.freeUntil);
  if (until === undefined) return { ok: false as const, error: 'Choose an end date in the future.' };
  return { ok: true as const, grant: await giveFree(p.data.email, until, p.data.note, admin) };
}

export async function removeFreeAccess(body: unknown) {
  const p = EmailBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Enter a valid email address.' };
  await removeGrant(p.data.email);
  return { ok: true as const };
}

const RoleBody = z.object({ email: Email, role: z.enum(['admin', 'user']), permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).optional() }).strict();

/** The owner makes someone an admin with chosen permissions, changes them, or makes them a user again. */
export async function setRole(owner: string, body: unknown) {
  const p = RoleBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Expected an email address, the role admin or user, and what an admin may do.' };
  const { email, role } = p.data;
  if (isOwnerEmail(email)) return { ok: false as const, error: 'Your own role cannot be changed.' };
  if (isAdminEmail(email)) return { ok: false as const, error: 'This admin is set in Vercel (ADMIN_EMAILS). Change it there.' };
  if (role === 'user') {
    await removeAdminRole(email);
    return { ok: true as const, role };
  }
  const permissions = PERMISSIONS.filter((x) => p.data.permissions?.includes(x));
  await setAdminRole({ email, permissions, by: owner, at: new Date().toISOString() });
  return { ok: true as const, role, permissions };
}

/** Email the sign-in steps again to an existing person. */
export async function emailSignIn(body: unknown) {
  const p = EmailBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Enter a valid email address.' };
  const found = await clerk().users.getUserList({ emailAddress: [p.data.email], limit: 1 });
  if (!found.data.length) return { ok: false as const, error: 'There is no account with this email yet. Create it first.' };
  const emailed = await sendWelcome(p.data.email, found.data[0].firstName ?? undefined, await grantFor(p.data.email));
  return emailed ? { ok: true as const } : { ok: false as const, error: 'The email could not be sent. Try again in a few minutes.' };
}

// ---------------------------------------------------------------- the welcome email
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const longDate = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function welcomeMail(email: string, name: string | undefined, grant: Grant | null, now = Date.now()) {
  const free = grant && grantActive(grant, now) ? grant : null;
  const signIn = `${appOrigin()}/?account=login`;
  const lines = [
    `Hi ${name?.split(/\s+/)[0] || 'there'},`,
    `An account for ${email} is ready on radiology.monster, where you read real CT, MRI, X-ray, mammography and ultrasound cases and get graded on the exact slice.`,
    ...(free ? [free.until ? `Free access to everything is switched on for you until ${longDate(free.until)}.` : 'Free access to everything is switched on for you, with no end date.'] : []),
    'To sign in, open radiology.monster, choose Sign in and enter this email address. We email you a code; there is no password.',
  ];
  const subject = free ? 'Your free radiology.monster access is ready' : 'Your radiology.monster account is ready';
  const why = 'You get this email because the radiology.monster team created this account for you. For education only, not for clinical diagnosis.';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#1d1d1f">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="margin:0 0 24px;font-weight:700;font-size:15px">radiology<span style="color:#4f46e5">.monster</span></p>
<div style="background:#fff;border-radius:18px;padding:28px 26px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;letter-spacing:-0.01em">${esc(subject)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#424245">${esc(l)}</p>`).join('')}
<p style="margin:22px 0 4px"><a href="${esc(signIn)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:12px">Sign in to radiology.monster</a></p>
</div>
<p style="margin:18px 6px 0;font-size:12px;line-height:1.5;color:#86868b">${esc(why)}</p>
</div></body></html>`;
  return { subject, html, text: `${subject}\n\n${lines.join('\n\n')}\n\nSign in: ${signIn}\n\n${why}` };
}

async function sendWelcome(email: string, name: string | undefined, grant: Grant | null): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !(await rateLimit(`welcome:${mailboxKey(email)}`, 3, 3600))) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], ...welcomeMail(email, name, grant) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error('Welcome email failed', { status: r.status });
    return r.ok;
  } catch {
    console.error('Welcome email failed');
    return false;
  }
}
