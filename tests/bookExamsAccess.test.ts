import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), kv: new Map<string, unknown>() }));
vi.mock('../server/auth', async (original) => ({ ...(await original<typeof import('../server/auth')>()), session: fake.session }));
vi.mock('../server/billing', () => ({ accessFor: fake.access, checkout: vi.fn() }));
vi.mock('../server/store', () => ({
  rateLimit: async () => true,
  db: () => ({ get: async (k: string) => structuredClone(fake.kv.get(k)) ?? null, set: async (k: string, v: unknown) => (fake.kv.set(k, structuredClone(v)), 'OK') }),
}));
import { handle } from '../server/handler';

const call = (path: string, init?: RequestInit) => handle(new Request(`https://www.radiology.monster/api/book-exams${path}`, init));
const post = (path: string, body: unknown) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://www.radiology.monster' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://www.radiology.monster');
  vi.stubEnv('WHOP_APP_ID', 'test');
  vi.stubEnv('KV_REST_API_URL', 'https://example.invalid');
  vi.stubEnv('KV_REST_API_TOKEN', 'test');
  fake.session.mockResolvedValue({ userId: 'reader', email: 'student@stu.ssst.edu.ba', name: 'Student' });
  fake.access.mockResolvedValue({ active: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  fake.kv.clear();
});

describe('who may take the book exams', () => {
  it('needs an account', async () => {
    fake.session.mockResolvedValue(null);
    expect((await call('')).status).toBe(401);
  });
  it('needs a membership', async () => {
    fake.access.mockResolvedValue({ active: false });
    expect((await call('')).status).toBe(402);
    expect((await post('/start', { chapter: 1 })).status).toBe(402);
  });
  it('needs the book: a member whose email does not serve the book is refused everywhere', async () => {
    fake.session.mockResolvedValue({ userId: 'other', email: 'someone@gmail.com', name: 'Other' });
    for (const r of [await call(''), await call('/attempt?id=bx-000000000000000000000000'), await post('/start', { chapter: 1 }), await post('/finish', { attemptId: 'x', answers: {} })]) expect(r.status).toBe(403);
  });
  it('lets a reader of the book list the chapters, start an exam and finish it', async () => {
    const list = await (await call('')).json();
    expect(list.chapters).toHaveLength(13);
    const start = await (await post('/start', { chapter: 2 })).json();
    expect(start.questions.length).toBeGreaterThan(20);
    expect(JSON.stringify(start)).not.toMatch(/"explanation":|"rubric":|"model":/);
    const done = await (await post('/finish', { attemptId: start.attemptId, answers: {} })).json();
    expect(done.result.points).toBe(0);
    expect((await post('/start', { chapter: 99 })).status).toBe(400);
  });
});
