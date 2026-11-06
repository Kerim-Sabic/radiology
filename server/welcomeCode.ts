import { db } from './store.js';

/**
 * The welcome offer a new account gets by email one day after it signs up: a personal Whop code for 40% off the first
 * payment of either plan, usable once and only for 72 hours from that email. It also works on the regional prices
 * (server/regional.ts) for visitors who get one. Codes start with "welcome-", are kept out of the admin promo list, and
 * checkout honours one only for the account it was made for (server/welcome.ts makes and sends them).
 */
export const WELCOME_PREFIX = 'welcome-';
export const WELCOME_PERCENT = 40;
export const WELCOME_HOURS = 72;
/** The code email goes out this long after sign-up (the plain welcome goes at once). */
export const OFFER_DELAY_HOURS = 24;

export interface WelcomeRecord {
  email: string;
  name: string;
  /** ISO time of the first sign-in. */
  joinedAt: string;
  /** The personal code, lower case as checkout sends it, once Whop has made it (when the code email goes out). */
  code?: string;
  promoId?: string;
  /** ISO time the code stops working: 72 hours after it was made. */
  expiresAt?: string;
  /** No offer for this account (it had access when the code email was due, stopped offer emails, or Whop could not make codes). */
  noOffer?: boolean;
  /** When the plain welcome went out (or why it did not). */
  sentAt?: string;
  /** When the email with the code went out. Until then the app shows no offer. */
  offerSentAt?: string;
  /**
   * When the email with the code is due (24 hours after sign-up). Records from before 2026-11-06 have none: their code
   * went out in the welcome itself.
   */
  offerDueAt?: string;
  reminderAt?: string;
  /** An account made before the welcome email existed, sent it from the admin page. */
  earlier?: boolean;
  /** The country of the first sign-in (Vercel's IP country): the email quotes that country's price when it has one. */
  country?: string;
}

export const welcomeKey = (userId: string) => `rvm:welcome:${userId}`;
export const welcomeCodeKey = (code: string) => `rvm:welcome-code:${code.toLowerCase()}`;

/** Whether the email with the code has gone out (an older record's code went out with its welcome). */
export const offerAnnounced = (r: WelcomeRecord) => !!r.offerSentAt || (!r.offerDueAt && !!r.code && !!r.sentAt);

/** Whether this code is the welcome code made for this account. */
export async function ownWelcomeCode(userId: string, code: string): Promise<boolean> {
  if (!code.toLowerCase().startsWith(WELCOME_PREFIX)) return false;
  return (await db().get<string>(welcomeCodeKey(code))) === userId;
}

/**
 * The live welcome offer of an account, for the plans screen; null before the email with the code went out (the code
 * is announced by that email, never first by the app) and once it has expired.
 */
export async function welcomeOffer(userId: string, now = Date.now()): Promise<{ code: string; expiresAt: string; percent: number } | null> {
  const r = await db().get<WelcomeRecord>(welcomeKey(userId));
  if (!r?.code || !offerAnnounced(r) || !r.expiresAt || Date.parse(r.expiresAt) <= now) return null;
  return { code: r.code, expiresAt: r.expiresAt, percent: WELCOME_PERCENT };
}
