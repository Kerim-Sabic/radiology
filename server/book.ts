import { get, head } from '@vercel/blob';
import { required } from './config.js';

export const BOOK_PATH = 'textbooks/learning-radiology-5e.pdf';
export const BOOK_SIZE = 73_363_798;
export const BOOK_SHA256 = '0f711fa48c1872ceb06cda81df9ec60b1de0eab0590b585dda0d9aae26dad1b1';
const MAX_RANGE = 2 * 1024 * 1024;

/** The textbook is served only to SSST students (verified university email); everyone else opens their own copy on their device. */
export const BOOK_EMAIL_DOMAIN = 'stu.ssst.edu.ba';
export function servesBook(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${BOOK_EMAIL_DOMAIN}`);
}

export function bookRange(value: string | null): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, BOOK_SIZE - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), BOOK_SIZE - 1) : BOOK_SIZE - 1;
  if (![start, end].every(Number.isSafeInteger) || start < 0 || end < start || start >= BOOK_SIZE || end - start + 1 > MAX_RANGE) return null;
  return { start, end };
}

/** Called only after the account and current membership have been verified. */
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
