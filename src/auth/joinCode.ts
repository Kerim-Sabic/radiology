/** A class join link (/join/CODE): its code is kept in this tab so it survives signing up, then the app asks to join. */
const KEY = 'rvm:join-code';
const CODE = /^[A-Za-z0-9_-]{10,24}$/;

export function pendingJoinCode(): string | null {
  const fromPath = /^\/join\/([A-Za-z0-9_-]{10,24})\/?$/.exec(location.pathname)?.[1] ?? null;
  try {
    if (fromPath) {
      sessionStorage.setItem(KEY, fromPath);
      return fromPath;
    }
    const kept = sessionStorage.getItem(KEY);
    return kept && CODE.test(kept) ? kept : null;
  } catch {
    return fromPath;
  }
}

export function clearJoinCode() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Storage is optional. */
  }
}

export interface Invitation {
  name: string;
  /** Whether the class still has free places. */
  free: boolean;
}

export async function fetchInvitation(code: string): Promise<Invitation | null> {
  try {
    const r = await fetch(`/api/class/invite?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
