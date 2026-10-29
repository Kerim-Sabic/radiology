import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    session: vi.fn(),
    mine: vi.fn(),
    cert: vi.fn(),
    db: {
      set: vi.fn(async (key: string, value: unknown) => (store.set(key, value), 'OK')),
      getdel: vi.fn(async (key: string) => {
        const value = store.get(key) ?? null;
        store.delete(key);
        return value;
      }),
    },
  };
});
vi.mock('../server/auth', async (original) => ({ ...(await original<typeof import('../server/auth')>()), session: fake.session }));
vi.mock('../server/billing', () => ({ accessFor: vi.fn(async () => ({ active: true })), checkout: vi.fn() }));
vi.mock('../server/store', () => ({ db: () => fake.db, rateLimit: async () => true }));
vi.mock('../server/certificates', () => ({ myCertificates: fake.mine, publicCertificate: fake.cert, claimCertificate: vi.fn() }));
vi.mock('../server/certificateShare', () => ({ certificateImage: async () => new Response(new Uint8Array([137, 80, 78, 71])), certificatePageHtml: vi.fn() }));
import { handle } from '../server/handler';
import { littleText } from '../server/linkedin';

const ORIGIN = 'https://www.radiology.monster';
const CERT = { id: 'abcDEF123_-x', name: 'Ada Lovelace', area: 'chest', level: 2, title: 'Chest Imaging', patients: 25, judged: 34, accuracy: 0.84, issuedAt: '2026-10-29T10:00:00.000Z' };
const start = (body: unknown) => handle(new Request(`${ORIGIN}/api/linkedin/start`, { method: 'POST', headers: { origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const callback = (query: string) => handle(new Request(`${ORIGIN}/api/linkedin/callback?${query}`));

/** A pretend LinkedIn: token, member, image upload and post, each recorded. */
function linkedIn(overrides: Partial<Record<'token' | 'userinfo' | 'image' | 'upload' | 'post', () => Response>> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const reply = {
    token: () => Response.json({ access_token: 'li-token', expires_in: 5184000 }),
    userinfo: () => Response.json({ sub: 'm3mb3r' }),
    image: () => Response.json({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/C4E/uploaded-image/0?ut=1', image: 'urn:li:image:C4E' } }),
    upload: () => new Response(null, { status: 201 }),
    post: () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7000000000000000001' } }),
    ...overrides,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url === 'https://www.linkedin.com/oauth/v2/accessToken') return reply.token();
      if (url === 'https://api.linkedin.com/v2/userinfo') return reply.userinfo();
      if (url === 'https://api.linkedin.com/rest/images?action=initializeUpload') return reply.image();
      if (url === 'https://api.linkedin.com/rest/posts') return reply.post();
      if (init.method === 'PUT') return reply.upload();
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

/** Starts a post and returns its one-time state. */
async function begin(text = 'Proud of this #radiology') {
  const r = await start({ id: CERT.id, text });
  expect(r.status).toBe(200);
  return new URL((await r.json()).url).searchParams.get('state')!;
}

beforeEach(() => {
  vi.stubEnv('APP_URL', ORIGIN);
  vi.stubEnv('WHOP_APP_ID', 'test');
  vi.stubEnv('KV_REST_API_URL', 'https://example.invalid');
  vi.stubEnv('KV_REST_API_TOKEN', 'test');
  vi.stubEnv('LINKEDIN_CLIENT_ID', 'li-client');
  vi.stubEnv('LINKEDIN_CLIENT_SECRET', 'li-secret');
  fake.store.clear();
  fake.session.mockResolvedValue({ userId: 'member', email: 'ada@example.com', name: 'Ada' });
  fake.mine.mockResolvedValue([CERT]);
  fake.cert.mockResolvedValue(CERT);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LinkedIn text', () => {
  it('escapes every reserved character and keeps hashtags as hashtags', () => {
    expect(littleText('Chest Imaging Certificate – Level 2 (Intermediate)')).toBe('Chest Imaging Certificate – Level 2 \\(Intermediate\\)');
    expect(littleText('Verify it: https://www.radiology.monster/certificate/abc_DEF-12')).toBe('Verify it: https://www.radiology.monster/certificate/abc\\_DEF-12');
    expect(littleText('#radiology #meded\n#chestradiology')).toBe('{hashtag|\\#|radiology} {hashtag|\\#|meded}\n{hashtag|\\#|chestradiology}');
    // A # inside a word, or on its own, is plain text.
    expect(littleText('C# and a#b, # alone')).toBe('C\\# and a\\#b, \\# alone');
    expect(littleText('a\\b|c{d}e@f[g]h<i>j*k~l')).toBe('a\\\\b\\|c\\{d\\}e\\@f\\[g\\]h\\<i\\>j\\*k\\~l');
  });
});

describe('Post it for me', () => {
  it('sends the holder to LinkedIn to allow one post, with the post kept for ten minutes', async () => {
    const r = await start({ id: CERT.id, text: '  My post  ' });
    expect(r.status).toBe(200);
    const url = new URL((await r.json()).url);
    expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'li-client',
      redirect_uri: `${ORIGIN}/api/linkedin/callback`,
      scope: 'openid profile w_member_social',
    });
    const state = url.searchParams.get('state')!;
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(fake.db.set).toHaveBeenCalledWith(`rvm:li:${state}`, { userId: 'member', certId: CERT.id, text: 'My post' }, { ex: 600 });
  });

  it('refuses certificates that are not yours, empty posts, other sites and a server without LinkedIn', async () => {
    fake.mine.mockResolvedValue([]);
    expect((await start({ id: CERT.id, text: 'Hi' })).status).toBe(400);
    fake.mine.mockResolvedValue([CERT]);
    expect((await start({ id: CERT.id, text: '   ' })).status).toBe(400);
    expect((await start({ id: CERT.id, text: 'x'.repeat(3001) })).status).toBe(400);
    const cross = await handle(new Request(`${ORIGIN}/api/linkedin/start`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ id: CERT.id, text: 'Hi' }) }));
    expect(cross.status).toBe(403);
    fake.session.mockResolvedValue(null);
    expect((await start({ id: CERT.id, text: 'Hi' })).status).toBe(401);
    fake.session.mockResolvedValue({ userId: 'member', email: 'ada@example.com', name: 'Ada' });
    vi.stubEnv('LINKEDIN_CLIENT_SECRET', '');
    expect((await start({ id: CERT.id, text: 'Hi' })).status).toBe(503);
    expect(fake.db.set).not.toHaveBeenCalled();
  });

  it('tells the certificates list whether posting is set up', async () => {
    expect(await (await handle(new Request(`${ORIGIN}/api/certificates`))).json()).toMatchObject({ linkedin: true });
    vi.stubEnv('LINKEDIN_CLIENT_ID', '');
    expect(await (await handle(new Request(`${ORIGIN}/api/certificates`))).json()).toMatchObject({ linkedin: false });
  });

  it('posts the certificate picture with the text, then returns to the certificate with a link to the post', async () => {
    const state = await begin('Earned the Chest Imaging Certificate – Level 2 (Intermediate)\n\n#radiology');
    const calls = linkedIn();
    const r = await callback(`code=auth-code&state=${state}`);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${ORIGIN}/certificate/${CERT.id}?linkedin=posted&post=urn%3Ali%3Ashare%3A7000000000000000001#add-to-linkedin`);
    const [token, me, image, upload, post] = calls;
    expect(Object.fromEntries(new URLSearchParams(String(token.init.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: `${ORIGIN}/api/linkedin/callback`,
      client_id: 'li-client',
      client_secret: 'li-secret',
    });
    expect(me.init.headers).toMatchObject({ Authorization: 'Bearer li-token' });
    expect(image.init.headers).toMatchObject({ Authorization: 'Bearer li-token', 'X-Restli-Protocol-Version': '2.0.0', 'LinkedIn-Version': '202610' });
    expect(JSON.parse(String(image.init.body))).toEqual({ initializeUploadRequest: { owner: 'urn:li:person:m3mb3r' } });
    expect(upload).toMatchObject({ url: 'https://www.linkedin.com/dms-uploads/C4E/uploaded-image/0?ut=1', init: { method: 'PUT' } });
    expect(upload.init.headers).toMatchObject({ Authorization: 'Bearer li-token' });
    expect(JSON.parse(String(post.init.body))).toEqual({
      author: 'urn:li:person:m3mb3r',
      commentary: 'Earned the Chest Imaging Certificate – Level 2 \\(Intermediate\\)\n\n{hashtag|\\#|radiology}',
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: 'urn:li:image:C4E', altText: "Ada Lovelace's Chest Imaging Certificate – Level 2 (Intermediate), issued by radiology.monster" } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });
    // The state works once, and nothing about the LinkedIn token is kept.
    expect((await callback(`code=auth-code&state=${state}`)).headers.get('location')).toBe(`${ORIGIN}/certificates`);
    expect(fake.db.set).toHaveBeenCalledTimes(1);
  });

  it('posts nothing when the permission is refused, or for another account', async () => {
    let state = await begin();
    const calls = linkedIn();
    let r = await callback(`error=user_cancelled_authorize&state=${state}`);
    expect(r.headers.get('location')).toBe(`${ORIGIN}/certificate/${CERT.id}?linkedin=cancelled#add-to-linkedin`);
    state = await begin();
    fake.session.mockResolvedValue({ userId: 'someone-else', email: 'x@example.com', name: 'X' });
    r = await callback(`code=auth-code&state=${state}`);
    expect(r.headers.get('location')).toBe(`${ORIGIN}/certificate/${CERT.id}?linkedin=failed#add-to-linkedin`);
    expect(calls).toHaveLength(0);
    expect((await callback('code=auth-code&state=made-up')).headers.get('location')).toBe(`${ORIGIN}/certificates`);
  });

  it('reports a failure without logging tokens, and never sends the token outside LinkedIn', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let state = await begin();
    linkedIn({ post: () => Response.json({ message: 'ACCESS_DENIED' }, { status: 403 }) });
    let r = await callback(`code=auth-code&state=${state}`);
    expect(r.headers.get('location')).toBe(`${ORIGIN}/certificate/${CERT.id}?linkedin=failed#add-to-linkedin`);
    expect(log).toHaveBeenCalledWith('LinkedIn post failed', { step: 'post', status: 403 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('li-token');
    state = await begin();
    const calls = linkedIn({ image: () => Response.json({ value: { uploadUrl: 'https://evil.example/upload', image: 'urn:li:image:C4E' } }) });
    r = await callback(`code=auth-code&state=${state}`);
    expect(r.headers.get('location')).toContain('linkedin=failed');
    expect(calls.some((c) => c.url.startsWith('https://evil.example'))).toBe(false);
    log.mockRestore();
  });
});
