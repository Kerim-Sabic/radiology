import { get } from '@vercel/blob';
import { RSNA_SHOWN, type ShownSeries } from './rsnaShown.js';

/**
 * RSNA Intracranial Aneurysm Detection (RSNA-ICA) teaching cases. RSNA's research use agreement forbids redistributing
 * the data; Kerim holds RSNA's written permission to show up to 100 MR and 100 CT series in the product, to members.
 * So their files (DICOM, outlines, lessons) never sit in this public repository or in the public `packs/` folder: they
 * live in the private Blob store under `rsna-ica/` and reach a member's browser only through `/api/rsna/…`, after the
 * session and the membership are checked. Guests and free accounts get 401 / 402.
 */
export const RSNA_BLOB_PREFIX = 'rsna-ica/';
export const RSNA_DOI = '10.1148/dataset.ica.2026';
export const RSNA_CREDIT = 'RSNA Intracranial Aneurysm Detection (RSNA-ICA) Dataset, used with permission';
/** RSNA's permission: at most this many series of each kind may be shown (a unit test counts them). */
export const RSNA_SHOW_CAP = { MR: 100, CT: 100 } as const;

/**
 * `/api/rsna/<pack>/<series>/<file>`: a pack file (`pack.json`, `lessons.json`), an outline (`targets/<hash>.json`) or a
 * slice named by its content hash. Names are opaque hashes, never patient or series identifiers.
 */
const FILE = /^\/api\/rsna\/(rsna-ica-[a-z0-9-]{1,32})\/(pack\.json|lessons\.json|targets\/[0-9a-f]{16}\.json|dicom\/[0-9a-f]{16}\/[0-9a-f]{16}\.dcm)$/;

/** The storage key of a file a member may load: a pack file, an outline, or a slice of a series on the shown list. */
export function rsnaKey(pathname: string, shown: ShownSeries[] = RSNA_SHOWN): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const m = FILE.exec(path);
  if (!m) return null;
  const series = /^dicom\/([0-9a-f]{16})\//.exec(m[2])?.[1];
  if (series && !shown.some((s) => s.series === series)) return null;
  return `${RSNA_BLOB_PREFIX}${m[1]}/${m[2]}`;
}

/** Series of each kind on the shown list (RSNA's permission caps both at 100). */
export function shownCounts(shown: ShownSeries[] = RSNA_SHOWN): Record<'MR' | 'CT', number> {
  return { MR: shown.filter((s) => s.modality === 'MR').length, CT: shown.filter((s) => s.modality === 'CT').length };
}

export type Visitor = 'member' | 'signed-in' | 'signed-out';

/**
 * Whether an account is a member, kept for a minute when it is (a study is hundreds of slice files; proxy.ts does the
 * same for packs). Only a yes is kept, so an ended membership closes these files within a minute.
 */
const members = new Map<string, number>();
export async function rsnaMember(userId: string, active: () => Promise<boolean>, now = Date.now()): Promise<boolean> {
  if ((members.get(userId) ?? 0) > now) return true;
  if (!(await active())) {
    members.delete(userId);
    return false;
  }
  if (members.size > 5000) for (const [k, until] of members) if (until <= now) members.delete(k);
  members.set(userId, now + 60_000);
  return true;
}

/** Serves one RSNA-ICA file to a member; everyone else is refused before storage is touched. */
export async function rsnaFile(request: Request, who: Visitor, read = readBlob, shown: ShownSeries[] = RSNA_SHOWN): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return refuse(405, 'Use GET.');
  if (who === 'signed-out') return refuse(401, 'Sign in required');
  if (who !== 'member') return refuse(402, 'Membership required');
  const key = rsnaKey(new URL(request.url).pathname, shown);
  if (!key) return refuse(404, 'Not found');
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return refuse(503, 'These cases are being set up.');
  const body = await read(key, token, request.signal);
  if (!body) return refuse(404, 'Not found');
  const slice = key.endsWith('.dcm');
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': slice ? 'application/dicom' : 'application/json; charset=utf-8',
      // Slices are named by their content, so the member's browser may keep them; everything else is checked each time.
      'Cache-Control': slice ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      'CDN-Cache-Control': 'no-store',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, noarchive',
    },
  });
}

async function readBlob(key: string, token: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  const result = await get(key, { token, access: 'private', abortSignal: signal }).catch(() => null);
  return result?.stream ?? null;
}

function refuse(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
