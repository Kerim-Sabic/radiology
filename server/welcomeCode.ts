import { db } from './store.js';

/**
 * The welcome offer every new account gets by email: a personal Whop code for 40% off the first payment of either plan,
 * usable once and only for 72 hours. Codes start with "welcome-", are kept out of the admin promo list, and checkout
 * honours one only for the account it was made for (server/welcome.ts makes and sends them).
 */
export const WELCOME_PREFIX = 'welcome-';
export const WELCOME_PERCENT = 40;
export const WELCOME_HOURS = 72;

export interface WelcomeRecord {
  email: string;
  name: string;
  /** ISO time of the first sign-in. */
  joinedAt: string;
  /** The personal code, lower case as checkout sends it, once Whop has made it. */
  code?: string;
  promoId?: string;
  /** ISO time the code stops working. */
  expiresAt?: string;
  /** No offer for this account (it already had access when the email went out, or Whop could not make codes). */
  noOffer?: boolean;
  sentAt?: string;
  reminderAt?: string;
}

export const welcomeKey = (userId: string) => `rvm:welcome:${userId}`;
export const welcomeCodeKey = (code: string) => `rvm:welcome-code:${code.toLowerCase()}`;

/** Whether this code is the welcome code made for this account. */
export async function ownWelcomeCode(userId: string, code: string): Promise<boolean> {
  if (!code.toLowerCase().startsWith(WELCOME_PREFIX)) return false;
  return (await db().get<string>(welcomeCodeKey(code))) === userId;
}

/** The live welcome offer of an account, for the plans screen; null once it has expired. */
export async function welcomeOffer(userId: string, now = Date.now()): Promise<{ code: string; expiresAt: string; percent: number } | null> {
  const r = await db().get<WelcomeRecord>(welcomeKey(userId));
  if (!r?.code || !r.expiresAt || Date.parse(r.expiresAt) <= now) return null;
  return { code: r.code, expiresAt: r.expiresAt, percent: WELCOME_PERCENT };
}
