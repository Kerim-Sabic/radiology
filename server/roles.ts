import { db } from './store.js';
import { mailboxKey } from './mailbox.js';

/** What an admin may see or do on the admin page. Only the owner decides these, per admin. */
export const PERMISSIONS = ['people', 'payments', 'add', 'free', 'promos', 'numbers', 'certificates', 'reports'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Admins the owner added on the dashboard, beside the ones in ADMIN_EMAILS. Kept by mailbox like free access; an
 * account becomes an admin only once its email is verified, and changes take effect at once (nothing is cached).
 */
export interface AdminRole {
  email: string;
  permissions: Permission[];
  /** Who gave the role, and when. */
  by: string;
  at: string;
}

const roleKey = (email: string) => `rvm:admin:${mailboxKey(email)}`;

export async function adminRole(email: string): Promise<AdminRole | null> {
  return db().get<AdminRole>(roleKey(email));
}

export async function setAdminRole(r: AdminRole) {
  await db().set(roleKey(r.email), r);
  await db().sadd('rvm:admins', mailboxKey(r.email));
}

export async function removeAdminRole(email: string) {
  await db().del(roleKey(email));
  await db().srem('rvm:admins', mailboxKey(email));
}

export async function allAdminRoles(): Promise<AdminRole[]> {
  const keys = (await db().smembers('rvm:admins')) as string[];
  if (!keys.length) return [];
  const found = (await db().mget<Array<AdminRole | null>>(...keys.map((k) => `rvm:admin:${k}`))) as Array<AdminRole | null>;
  return found.filter((r): r is AdminRole => !!r);
}

/**
 * A professor the owner added. They teach a class on /class: add students by email and follow their study days, exam
 * results and certificates. `seats` is how many of their students they may give free access (0: none), until `freeUntil`.
 */
export interface ProfessorRole {
  email: string;
  seats: number;
  /** End of the free access their students get (ISO time), or null for no end date. */
  freeUntil: string | null;
  by: string;
  at: string;
}

const professorKey = (email: string) => `rvm:professor:${mailboxKey(email)}`;

export async function professorRole(email: string): Promise<ProfessorRole | null> {
  return db().get<ProfessorRole>(professorKey(email));
}

export async function setProfessorRole(r: ProfessorRole) {
  await db().set(professorKey(r.email), r);
  await db().sadd('rvm:professors', mailboxKey(r.email));
}

export async function removeProfessorRole(email: string) {
  await db().del(professorKey(email));
  await db().srem('rvm:professors', mailboxKey(email));
}

export async function allProfessorRoles(): Promise<ProfessorRole[]> {
  const keys = (await db().smembers('rvm:professors')) as string[];
  if (!keys.length) return [];
  const found = (await db().mget<Array<ProfessorRole | null>>(...keys.map((k) => `rvm:professor:${k}`))) as Array<ProfessorRole | null>;
  return found.filter((r): r is ProfessorRole => !!r);
}
