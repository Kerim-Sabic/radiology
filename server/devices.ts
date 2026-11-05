import { randomBytes } from 'node:crypto';
import { db } from './store.js';

/**
 * One account, one person. Only one device is signed in at a time (server/auth.ts), sign-in takes a code from the
 * account's inbox, and every other Clerk sign-in ends when a new one starts (server/clerk.ts). On top of that:
 *
 * - Each sign-in is logged: when, the country (Vercel's IP country) and the kind of device. Never the IP itself.
 * - Each browser keeps a random device id in a cookie. An account may sign in on at most DEVICE_LIMIT different
 *   devices in 30 days; a student's phone, laptop and library computer never come close, a class passing one
 *   account around does. Admins and professors have no limit.
 * - The admin page flags accounts that look shared (many devices, or several countries), and can clear the log.
 * - A browser that was signed out by another sign-in is told where and when, so an owner notices a sharer.
 */

export const DEVICE_COOKIE = '__Host-rvm-device';
export const DEVICE_COOKIE_SECONDS = 400 * 86400;
export const DEVICE_LIMIT = 10;
const WINDOW_MS = 30 * 86400000;
const KEEP = 60;

export interface SignIn {
  at: string;
  /** The browser's device id (a random cookie value). */
  device: string;
  country: string | null;
  /** "iPhone · Safari", "Windows · Chrome". */
  label: string;
}

export const signInsKey = (userId: string) => `rvm:signins:${userId}`;
export const newDeviceId = () => randomBytes(18).toString('base64url');
export const validDeviceId = (value: string | null | undefined): value is string => !!value && /^[\w-]{20,64}$/.test(value);
const countryCode = (value: string | null | undefined) => (value && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null);

/** The kind of device and browser from a user agent, in a few words. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent || '';
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const browser = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV/.test(ua) ? 'Facebook' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return browser ? `${system} · ${browser}` : system;
}

export interface SignInContext { device: string; country?: string | null; userAgent?: string | null }

const recent = (log: SignIn[] | null | undefined, now: number) => (log ?? []).filter((s) => now - Date.parse(s.at) < WINDOW_MS);

export interface DeviceSummary {
  /** Different devices in the last 30 days. */
  devices: number;
  countries: string[];
  signIns: number;
  /** Looks shared: many devices, three or more countries, or two countries within a day. */
  flagged: boolean;
}

export function deviceSummary(log: SignIn[] | null | undefined, now = Date.now()): DeviceSummary | null {
  const last30 = recent(log, now);
  if (!last30.length) return null;
  const devices = new Set(last30.map((s) => s.device)).size;
  const countries = [...new Set(last30.map((s) => s.country).filter((c): c is string => !!c))];
  // Sign-ins are newest first; two in different countries less than a day apart is not a trip.
  const quickHop = last30.some((s, i) => {
    const next = last30[i + 1];
    return !!next && !!s.country && !!next.country && s.country !== next.country && Date.parse(s.at) - Date.parse(next.at) < 86400000;
  });
  return { devices, countries, signIns: last30.length, flagged: devices >= 6 || countries.length >= 3 || quickHop };
}

export class DeviceLimitError extends Error {
  constructor(readonly until: string) {
    super(`This account has signed in on ${DEVICE_LIMIT} different devices in the last 30 days, the most one person needs. Sign in on a device you used before, or write to us if this is a mistake. New devices open again on ${new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`);
  }
}

/**
 * Logs a sign-in, or refuses it (DeviceLimitError) when it is a new device and the account already used DEVICE_LIMIT
 * devices in 30 days. `unlimited`: admins and professors.
 */
export async function recordSignIn(userId: string, ctx: SignInContext, unlimited: boolean, now = Date.now()): Promise<SignIn> {
  const log = (await db().get<SignIn[]>(signInsKey(userId))) ?? [];
  const last30 = recent(log, now);
  const known = last30.some((s) => s.device === ctx.device);
  if (!unlimited && !known) {
    const lastSeen = new Map<string, number>();
    for (const s of last30) lastSeen.set(s.device, Math.max(lastSeen.get(s.device) ?? 0, Date.parse(s.at)));
    if (lastSeen.size >= DEVICE_LIMIT) {
      // The day the oldest device leaves the 30-day window, and a slot opens.
      const until = Math.min(...lastSeen.values()) + WINDOW_MS;
      throw new DeviceLimitError(new Date(until).toISOString());
    }
  }
  const entry: SignIn = { at: new Date(now).toISOString(), device: ctx.device, country: countryCode(ctx.country), label: deviceLabel(ctx.userAgent ?? '') };
  await db().set(signInsKey(userId), [entry, ...log].slice(0, KEEP), { ex: 60 * 86400 });
  return entry;
}

/** The latest sign-in of an account, if it came from another device than `device`. */
export async function latestSignInElsewhere(userId: string, device: string | null): Promise<Omit<SignIn, 'device'> | null> {
  const latest = (await db().get<SignIn[]>(signInsKey(userId)))?.[0];
  if (!latest || (device && latest.device === device)) return null;
  return { at: latest.at, country: latest.country, label: latest.label };
}

export async function clearSignIns(userId: string) {
  await db().del(signInsKey(userId));
}
