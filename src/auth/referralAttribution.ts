import { affiliateCode } from '../../shared/referrals';

const key = 'rvm:referral:v1';
const maxAge = 30 * 86400000;

/** Remember a referral through email verification and return visits for 30 days.
 * A new explicit referral link replaces the previous one. Storage is optional.
 */
export function rememberReferral(search: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined, now = Date.now()): string | undefined {
  const incoming = affiliateCode(new URLSearchParams(search).get('a'));
  try {
    if (incoming) {
      storage?.setItem(key, JSON.stringify({ code: incoming, expiresAt: now + maxAge }));
      return incoming;
    }
    const saved = JSON.parse(storage?.getItem(key) || 'null');
    if (saved && Number.isFinite(saved.expiresAt) && saved.expiresAt > now && saved.expiresAt <= now + maxAge) return affiliateCode(saved.code);
    storage?.removeItem(key);
  } catch { /* Referral links still work when browser storage is unavailable. */ }
  return incoming;
}

export function currentReferral() {
  let storage: Storage | undefined;
  try { storage = localStorage; } catch { /* Private browsing may disable storage. */ }
  return rememberReferral(location.search, storage);
}
