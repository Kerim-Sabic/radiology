import { db } from './store.js';
import { mailboxKey } from './mailbox.js';

/**
 * Free access an admin gave to an email address. It is keyed by the mailbox, so it works before that person has an
 * account and whichever way they write a Gmail address; it opens only for an account whose email is verified.
 */
export interface Grant {
  email: string;
  /** End of the free access (ISO time), or null for no end date. */
  until: string | null;
  /** A private note for the admins (who it is, why). */
  note?: string;
  /** The admin who gave it, and when. */
  by: string;
  at: string;
}

const grantKey = (email: string) => `rvm:grant:${mailboxKey(email)}`;

export const grantActive = (g: Grant, now = Date.now()) => !g.until || Date.parse(g.until) > now;

export async function grantFor(email: string): Promise<Grant | null> {
  return db().get<Grant>(grantKey(email));
}

export async function setGrant(g: Grant) {
  await db().set(grantKey(g.email), g);
  await db().sadd('rvm:grants', mailboxKey(g.email));
}

export async function removeGrant(email: string) {
  await db().del(grantKey(email));
  await db().srem('rvm:grants', mailboxKey(email));
}

/** Every grant, active or ended. */
export async function allGrants(): Promise<Grant[]> {
  const keys = (await db().smembers('rvm:grants')) as string[];
  const out: Grant[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const found = (await db().mget<Array<Grant | null>>(...chunk.map((k) => `rvm:grant:${k}`))) as Array<Grant | null>;
    for (const g of found) if (g) out.push(g);
  }
  return out;
}
