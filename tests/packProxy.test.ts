import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), rate: vi.fn() }));
vi.mock('../server/auth', async (original) => ({ ...(await original<typeof import('../server/auth')>()), session: fake.session }));
vi.mock('../server/billing', () => ({ accessFor: fake.access }));
vi.mock('../server/store', () => ({ rateLimit: fake.rate, db: () => ({}) }));
import proxy, { cacheControl, GUEST_FILES_PER_10_MIN } from '../proxy';
import { FREE_EDITION } from '../server/freeEdition.generated';

// Each test uses its own session token: the proxy remembers a member's yes per session for a minute.
let n = 0;
const token = () => `t${String(++n).padStart(42, '0')}`;
const get = (path: string, tok: string | null) =>
  new Request(`https://www.radiology.monster${path}`, { headers: tok ? { cookie: `__Host-rvm-session=${tok}` } : {} });
// A members-only slice (not one of the free sample patients).
const DICOM = '/packs/us-breast-3/dicom/us-0a1b2c3d4e/0123456789abcdef.dcm';

beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://www.radiology.monster');
  vi.stubEnv('WHOP_APP_ID', 'test');
  vi.stubEnv('KV_REST_API_URL', 'https://example.invalid');
  vi.stubEnv('KV_REST_API_TOKEN', 'test');
  fake.session.mockResolvedValue({ userId: 'member', email: 'm@example.org', name: 'M', tokenHash: 'x' });
  fake.access.mockResolvedValue({ active: true });
  fake.rate.mockResolvedValue(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('pack files: access and caching', () => {
  it('turns away a visitor who is not signed in, and a signed-in visitor without a plan outside the free files', async () => {
    expect((await proxy(get(DICOM, null))).status).toBe(401);
    fake.session.mockResolvedValue(null);
    expect((await proxy(get(DICOM, token()))).status).toBe(401);
    fake.session.mockResolvedValue({ userId: 'free', email: 'f@example.org', name: 'F', tokenHash: 'y' });
    fake.access.mockResolvedValue({ active: false });
    expect((await proxy(get(DICOM, token()))).status).toBe(402);
  });

  it('checks a member once per minute, not once per file, and keeps only a yes', async () => {
    const tok = token();
    for (let i = 0; i < 20; i++) expect((await proxy(get(DICOM, tok))).status).not.toBeGreaterThanOrEqual(400);
    expect(fake.session).toHaveBeenCalledTimes(1);
    expect(fake.access).toHaveBeenCalledTimes(1);
    // A no is never kept: a new member is let in on the very next request.
    const fresh = token();
    fake.access.mockResolvedValue({ active: false });
    expect((await proxy(get(DICOM, fresh))).status).toBe(402);
    fake.access.mockResolvedValue({ active: true });
    expect((await proxy(get(DICOM, fresh))).status).not.toBeGreaterThanOrEqual(400);
  });

  it('asks again after a minute, so an ended membership closes the files', async () => {
    vi.useFakeTimers();
    try {
      const tok = token();
      expect((await proxy(get(DICOM, tok))).status).not.toBeGreaterThanOrEqual(400);
      fake.access.mockResolvedValue({ active: false });
      vi.advanceTimersByTime(61_000);
      expect((await proxy(get(DICOM, tok))).status).toBe(402);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a visitor with no account open only the always-free sample patients, limited per address', async () => {
    const xray = FREE_EDITION.cases['cxr-00003400-003'];
    const slice = `${xray.prefixes[0]}0123456789abcdef.dcm`;
    for (const path of [slice, ...xray.files, ...FREE_EDITION.shared.slice(0, 3)]) expect((await proxy(get(path, null))).status, path).not.toBeGreaterThanOrEqual(400);
    expect(fake.rate).toHaveBeenCalledWith(expect.stringMatching(/^guest-packs:[0-9a-f]{64}$/), GUEST_FILES_PER_10_MIN, 600);
    // Members-only files, the case of the week, and paths that try to leave a free folder stay closed.
    const weekly = FREE_EDITION.cases[FREE_EDITION.weekly[0]];
    for (const path of [DICOM, `${weekly?.prefixes[0] ?? '/packs/pe-cta/dicom/x/'}0123456789abcdef.dcm`, `${xray.prefixes[0]}../../lessons-secret.json`, `${xray.prefixes[0]}deeper/0123456789abcdef.dcm`])
      expect((await proxy(get(path, null))).status, path).toBe(401);
    // Past the limit, a visitor with no account waits; an account is never limited here.
    fake.rate.mockResolvedValue(false);
    expect((await proxy(get(slice, null))).status).toBe(429);
    expect((await proxy(get(slice, token()))).status).not.toBeGreaterThanOrEqual(400);
  });

  it('lets the browser keep only the content-addressed slice files, and never lets a CDN cache anything', async () => {
    expect(cacheControl(DICOM)).toBe('private, max-age=31536000, immutable');
    for (const p of ['/packs/cxr-findings/pack.json', '/packs/cxr-findings/lessons.json', '/packs/cxr-findings/targets/x.json',
      '/packs/cxr-findings/thumbs/dx-ef3021541f.png', '/content/curriculum.v1.json', '/packs/x/dicom/a/notahash.dcm'])
      expect(cacheControl(p), p).toBe('private, no-cache');
    const r = await proxy(get(DICOM, token()));
    expect(r.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(r.headers.get('cdn-cache-control')).toBe('no-store');
    expect(r.headers.get('vary')).toBe('Cookie');
  });
});
