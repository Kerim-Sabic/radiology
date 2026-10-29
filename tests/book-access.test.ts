import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), head: vi.fn(), get: vi.fn() }));
vi.mock('../server/auth', async original => ({ ...await original<typeof import('../server/auth')>(), session: fake.session }));
vi.mock('../server/billing', () => ({ accessFor: fake.access, checkout: vi.fn() }));
vi.mock('@vercel/blob', () => ({ head: fake.head, get: fake.get }));
import { handle } from '../server/handler';
import { BOOK_PATH, BOOK_SIZE, bookAccountKey, bookGift, bookRange, mailbox, servesBook } from '../server/book';
const request = (method = 'GET', range = 'bytes=0-1023') => new Request('https://www.radiology.monster/api/book', { method, headers: { Range: range } });
beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://www.radiology.monster'); vi.stubEnv('WHOP_APP_ID', 'test');
  vi.stubEnv('KV_REST_API_URL', 'https://example.invalid'); vi.stubEnv('KV_REST_API_TOKEN', 'test'); vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'private-test-token');
  fake.session.mockResolvedValue({ userId: 'member', email: 'student@stu.ssst.edu.ba', name: 'Student' }); fake.access.mockResolvedValue({ active: true });
  fake.head.mockResolvedValue({ size: BOOK_SIZE, contentType: 'application/pdf' });
  fake.get.mockImplementation(async () => ({ stream: new Response(new Uint8Array(1024)).body, headers: new Headers({ 'content-range': `bytes 0-1023/${BOOK_SIZE}` }) }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('protected member textbook', () => {
  it.each(['GET', 'HEAD'])('rejects anonymous %s before touching storage', async method => {
    fake.session.mockResolvedValue(null);
    expect((await handle(request(method))).status).toBe(401);
    expect(fake.get).not.toHaveBeenCalled(); expect(fake.head).not.toHaveBeenCalled();
  });
  it('rejects unpaid or revoked membership', async () => {
    fake.access.mockResolvedValue({ active: false });
    expect((await handle(request())).status).toBe(402); expect(fake.get).not.toHaveBeenCalled();
  });
  it('serves the book only to verified SSST student emails; other members open their own copy', async () => {
    fake.session.mockResolvedValue({ userId: 'member', email: 'someone@gmail.com', name: 'Member' });
    for (const method of ['GET', 'HEAD']) expect((await handle(request(method))).status).toBe(403);
    expect(fake.get).not.toHaveBeenCalled(); expect(fake.head).not.toHaveBeenCalled();
    expect(servesBook('Student@STU.SSST.EDU.BA ')).toBe(true);
    for (const email of ['x@ssst.edu.ba', 'x@evilstu.ssst.edu.ba', 'x@sub.stu.ssst.edu.ba', 'x@stu.ssst.edu.ba.evil.com', 'stu.ssst.edu.ba@gmail.com']) expect(servesBook(email)).toBe(false);
  });
  it('also serves named accounts (BOOK_EMAILS, or the hashed list), matching the mailbox however it is written', async () => {
    expect(mailbox(' Ada.Love+radiology@GoogleMail.com ')).toBe('adalove@gmail.com');
    expect(mailbox('Ada.Love+x@example.org')).toBe('ada.love+x@example.org'); // only Gmail ignores dots and tags
    expect(bookAccountKey('ada.love@gmail.com')).toBe(bookAccountKey('ADALOVE+book@gmail.com'));
    expect(servesBook('ada.love@gmail.com')).toBe(false);
    vi.stubEnv('BOOK_EMAILS', ' AdaLove@gmail.com , friend@example.org');
    expect(servesBook('ada.love@gmail.com')).toBe(true);
    expect(servesBook('Friend@Example.org')).toBe(true);
    for (const email of ['adalove@yahoo.com', 'friend@example.org.evil.com', 'other@example.org']) expect(servesBook(email)).toBe(false);
    fake.session.mockResolvedValue({ userId: 'member', email: 'ada.love@gmail.com', name: 'Ada' });
    expect((await handle(request('HEAD'))).status).toBe(200);
    // Named accounts get the book without a plan (only the book); SSST students still need a membership.
    expect(bookGift('ada.love@gmail.com')).toBe(true);
    expect(bookGift('student@stu.ssst.edu.ba')).toBe(false);
    fake.access.mockResolvedValue({ active: false });
    expect((await handle(request('HEAD'))).status).toBe(200);
    const session = await handle(new Request('https://www.radiology.monster/api/session'));
    expect(await session.json()).toMatchObject({ book: true, access: { active: false } });
    fake.session.mockResolvedValue({ userId: 'member', email: 'student@stu.ssst.edu.ba', name: 'Student' });
    expect((await handle(request('HEAD'))).status).toBe(402);
    expect(await (await handle(new Request('https://www.radiology.monster/api/session'))).json()).toMatchObject({ book: false });
  });
  it('provides private metadata for the reader without returning PDF bytes', async () => {
    const response = await handle(request('HEAD'));
    expect(response.status).toBe(200); expect(response.headers.get('content-length')).toBe(String(BOOK_SIZE));
    expect(response.headers.get('content-type')).toBe('application/pdf'); expect(await response.text()).toBe('');
    expect(fake.head).toHaveBeenCalledWith(BOOK_PATH, { token: 'private-test-token' });
  });
  it('returns a bounded range and prevents shared caching or storage-token exposure', async () => {
    const response = await handle(request());
    expect(response.status).toBe(206); expect((await response.arrayBuffer()).byteLength).toBe(1024);
    expect(response.headers.get('content-range')).toBe(`bytes 0-1023/${BOOK_SIZE}`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store'); expect(response.headers.get('vary')).toBe('Cookie');
    expect([...response.headers.values()].join(' ')).not.toContain('private-test-token');
  });
  it.each(['bytes=0-9999999','bytes=0-1,5-6','bytes=73363798-','bytes=-0','bytes=20-10',''])('rejects invalid or oversized ranges: %s', async range => {
    expect((await handle(request('GET', range))).status).toBe(416); expect(fake.get).not.toHaveBeenCalled();
  });
  it('supports reading the final cross-reference bytes', () => {
    expect(bookRange('bytes=-1024')).toEqual({ start: BOOK_SIZE - 1024, end: BOOK_SIZE - 1 });
  });
  it('fails closed if storage ignores the requested range', async () => {
    fake.get.mockResolvedValue({ stream: new Response('wrong response').body, headers: new Headers() });
    const response = await handle(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('wrong response');
  });
});
