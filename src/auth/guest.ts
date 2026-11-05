/**
 * A visitor with no account may open the always-free sample patients straight from a link (an ad, a post, a friend):
 * `/read/<free case>` opens the reading room as a guest. Everything else asks them to sign in. The server allows the
 * same files (server/free.ts, proxy.ts).
 */
import { FREE_CASES } from '../content/weekly';

/** The sample patient a visitor tries straight from the homepage, before any account: the free chest X-ray, "Find the pneumothorax". */
export const TRY_CASE = 'cxr-00003400-003';
export const TRY_CASE_URL = `/read/${TRY_CASE}?task=${encodeURIComponent(`${TRY_CASE}:locate`)}&mode=practice`;

export function guestCaseId(pathname: string): string | null {
  const m = /^\/read\/([^/?#]+)\/?$/.exec(pathname);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return FREE_CASES.includes(id) ? id : null;
}
