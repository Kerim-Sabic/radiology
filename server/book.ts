import { createHash } from 'node:crypto';
import { get, head } from '@vercel/blob';
import { required } from './config.js';

export const BOOK_PATH = 'textbooks/learning-radiology-5e.pdf';
export const BOOK_SIZE = 73_363_798;
export const BOOK_SHA256 = '0f711fa48c1872ceb06cda81df9ec60b1de0eab0590b585dda0d9aae26dad1b1';
const MAX_RANGE = 2 * 1024 * 1024;

/**
 * The textbook is served only to SSST students (verified university email) and a few named accounts; everyone else
 * opens their own copy on their device.
 */
export const BOOK_EMAIL_DOMAIN = 'stu.ssst.edu.ba';

/** One mailbox, however it is written: lower case, and for Gmail without dots or a +tag. */
export function mailbox(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  const [local, domain] = [e.slice(0, at), e.slice(at + 1)];
  return domain === 'gmail.com' || domain === 'googlemail.com' ? `${local.split('+')[0].replaceAll('.', '')}@gmail.com` : e;
}
export const bookAccountKey = (email: string) => createHash('sha256').update(mailbox(email)).digest('hex');

// Named accounts, kept as SHA-256 of the mailbox so this public repository does not list their addresses.
// More can be added without a release in BOOK_EMAILS (comma-separated, server-only).
const BOOK_ACCOUNTS = new Set([
  'ecdda4cc9d17958d627317956285afc3bae148724bfb85a493b4695b00e034ee',
  'd6ff5a5adeca1f50c18a44f71f4d0eb8c831b2935181155f534c29fb8decf4fc',
]);

/** Named accounts get the book even without a plan; only the book: the rest of the app stays the free edition. */
export function bookGift(email: string): boolean {
  const extra = (process.env.BOOK_EMAILS || '').split(',').map(v => v.trim()).filter(Boolean).map(mailbox);
  return extra.includes(mailbox(email)) || BOOK_ACCOUNTS.has(bookAccountKey(email));
}

/** SSST students (with a membership) and named accounts. */
export function servesBook(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${BOOK_EMAIL_DOMAIN}`) || bookGift(email);
}

export function bookRange(value: string | null): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, BOOK_SIZE - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), BOOK_SIZE - 1) : BOOK_SIZE - 1;
  if (![start, end].every(Number.isSafeInteger) || start < 0 || end < start || start >= BOOK_SIZE || end - start + 1 > MAX_RANGE) return null;
  return { start, end };
}

/** Called only after the account, and its membership or named access, have been verified. */
export async function memberBook(request: Request): Promise<Response> {
  const headers = new Headers({
    'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="learning-radiology-5e.pdf"',
    'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
    'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, noarchive',
    'X-Book-SHA256': BOOK_SHA256,
  });
  const token = required('BLOB_READ_WRITE_TOKEN');
  if (request.method === 'HEAD') {
    const metadata = await head(BOOK_PATH, { token });
    if (metadata.size !== BOOK_SIZE || !metadata.contentType.includes('pdf')) throw new Error('Unexpected textbook file');
    headers.set('Content-Length', String(BOOK_SIZE));
    return new Response(null, { headers });
  }
  const range = bookRange(request.headers.get('range'));
  if (!range) {
    headers.set('Content-Range', `bytes */${BOOK_SIZE}`);
    return new Response(null, { status: 416, headers });
  }
  const contentRange = `bytes ${range.start}-${range.end}/${BOOK_SIZE}`;
  const result = await get(BOOK_PATH, { token, access: 'private', headers: { Range: `bytes=${range.start}-${range.end}` }, abortSignal: request.signal });
  if (!result?.stream || result.headers.get('content-range') !== contentRange) {
    await result?.stream?.cancel();
    throw new Error('Textbook range is unavailable');
  }
  headers.set('Content-Range', contentRange);
  headers.set('Content-Length', String(range.end - range.start + 1));
  // Bounded ranges fit Vercel's response limit; the private storage URL/token never reach the browser.
  return new Response(result.stream, { status: 206, headers });
}
