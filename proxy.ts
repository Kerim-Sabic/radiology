import { next } from '@vercel/functions';
import { hash, readCookie, session, SESSION_COOKIE } from './server/auth.js';
import { accessFor } from './server/billing.js';
import { readiness } from './server/config.js';
import { freePathAllowed } from './server/free.js';
import { json } from './server/handler.js';
import { rateLimit } from './server/store.js';

/** Files a visitor with no account may load per address in 10 minutes: both sample patients several times over. */
export const GUEST_FILES_PER_10_MIN = 2000;

// Runs before the CDN cache: direct DICOM and curriculum JSON require paid access too. A free account (signed in,
// no plan) and a visitor with no account (from an ad or a shared link) get only the always-free sample patients.
export default async function proxy(request: Request) {
  try {
    if (!readiness().auth) return json({ error: 'Access is being configured' }, 503);
    const who = await visitor(request);
    const path = new URL(request.url).pathname;
    if (who === 'signed-out') {
      if (!freePathAllowed(path)) return json({ error: 'Sign in required' }, 401);
      const address = hash(request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown');
      if (!(await rateLimit(`guest-packs:${address}`, GUEST_FILES_PER_10_MIN, 600))) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
    } else if (who !== 'member' && !freePathAllowed(path)) return json({ error: 'Membership required' }, 402);
    return next({ headers: { 'Cache-Control': cacheControl(path), 'CDN-Cache-Control': 'no-store', Vary: 'Cookie' } });
  } catch { return json({ error: 'Unable to verify access' }, 503); }
}

/**
 * Who sends this request. A member's yes is kept for a minute per session on a warm instance: opening a study reads
 * hundreds of slice files, and each one would otherwise repeat the same session and membership lookups. Only a yes is
 * kept, so a new member is let in at once, and a sign-out, an ended membership or a revoked session closes pack files
 * within a minute (the site and the API check every request).
 */
export async function visitor(request: Request): Promise<'member' | 'signed-in' | 'signed-out'> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!/^[\w-]{43}$/.test(token)) return 'signed-out';
  const key = hash(token);
  const now = Date.now();
  if ((members.get(key) ?? 0) > now) return 'member';
  const user = await session(request);
  if (!user) {
    members.delete(key);
    return 'signed-out';
  }
  if (!(await accessFor(user.userId)).active) {
    members.delete(key);
    return 'signed-in';
  }
  if (members.size > 5000) for (const [k, until] of members) if (until <= now) members.delete(k);
  members.set(key, now + MEMBER_TTL_MS);
  return 'member';
}
const MEMBER_TTL_MS = 60_000;
const members = new Map<string, number>();

/**
 * Slice files are named by their content hash (`/packs/<pack>/dicom/<series>/<sha256 prefix>.dcm`), so they never change:
 * the browser may keep them, privately, instead of downloading a study again. Everything else (manifests, lessons,
 * outlines, thumbnails, curriculum) is checked with the server on every use and downloaded again only when it changed.
 */
export function cacheControl(path: string): string {
  return /^\/packs\/[^/]+\/dicom\/[^/]+\/[0-9a-f]{16}\.dcm$/.test(path) ? 'private, max-age=31536000, immutable' : 'private, no-cache';
}
