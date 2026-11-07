/**
 * The anonymous event log: what it accepts, what it never keeps, whose events it drops, and the Journeys it answers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const fake = vi.hoisted(() => ({ lists: new Map<string, string[]>(), expires: new Map<string, number>(), allow: true }));
vi.mock('../server/store', () => ({
  db: () => ({
    rpush: async (k: string, v: string) => fake.lists.set(k, [...(fake.lists.get(k) ?? []), v]).get(k)!.length,
    expire: async (k: string, s: number) => fake.expires.set(k, s),
    lrange: async (k: string) => fake.lists.get(k) ?? [],
  }),
  rateLimit: async () => fake.allow,
}));

import { accountHash, device, dropReason, ingestEvents, logServerEvent, parseBatch } from '../server/events';
import { dayRange, flatten, FUNNEL_STEPS, journeys, quantile } from '../server/journeys';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../shared/events';
import { armFor, EXPERIMENTS, unitHash } from '../src/services/experiments';

const VID = 'abcdefghij012345';
const SID = 'sessionid0123456';
const PHONE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const batch = (ev: unknown[], extra: Record<string, unknown> = {}) => ({ v: 1, vid: VID, sid: SID, ev, ...extra });
const req = (host = 'www.radiology.monster', headers: Record<string, string> = {}) =>
  new Request(`https://${host}/api/ev`, { method: 'POST', headers: { 'user-agent': PHONE, 'x-vercel-ip-country': 'in', 'x-forwarded-for': '203.0.113.9', ...headers } });

beforeEach(() => {
  fake.lists.clear();
  fake.expires.clear();
  fake.allow = true;
});

describe('the event schema', () => {
  it('accepts dictionary events with their own props only', () => {
    expect(parseBatch(batch([[1, 'land', { path: '/read/x', tag: 'meta:reel002:h1', ref: 'l.instagram.com', et: '4g' }], [2, 'mark', { task: 't', tool: 'point', secs: 4 }]]))).not.toBeNull();
    expect(parseBatch(batch([[1, 'nope']]))).toBeNull();
    expect(parseBatch(batch([[1, 'mark', { secs: '4' }]]))).toBeNull(); // wrong type
    expect(parseBatch(batch([[1, 'mark', { email: 'x' }]]))).toBeNull(); // unknown key
    expect(parseBatch(batch(Array.from({ length: 31 }, (_, i) => [i + 1, 'page', { path: '/' }])))).toBeNull();
    expect(parseBatch({ ...batch([[1, 'page', { path: '/' }]]), ip: '1.2.3.4' })).toBeNull(); // no extra fields
    expect(parseBatch(batch([[1, 'page']], { vid: 'short' }))).toBeNull();
  });

  it('never takes an email or long free text, and a browser cannot log a checkout or a payment', () => {
    expect(parseBatch(batch([[1, 'page', { path: '/a@b.com' }]]))).toBeNull();
    expect(parseBatch(batch([[1, 'page', { path: 'x'.repeat(81) }]]))).toBeNull();
    for (const name of Object.keys(SERVER_EVENTS)) expect(parseBatch(batch([[1, name]])), name).toBeNull();
  });

  it('has every event documented in docs/TRACKING.md', () => {
    const doc = readFileSync('docs/TRACKING.md', 'utf8');
    for (const name of [...Object.keys(CLIENT_EVENTS), ...Object.keys(SERVER_EVENTS)]) expect(doc, name).toContain(`\`${name}\``);
  });
});

describe('whose events are kept', () => {
  it('drops localhost, previews, the test suite, automated browsers, bots and the team', () => {
    expect(dropReason(req('localhost'), {}, 'visitor')).toBe('host');
    expect(dropReason(req('radiology-git-main-kerim.vercel.app'), {}, 'visitor')).toBe('host');
    expect(dropReason(req(undefined, { 'x-rvm-test': '1' }), {}, 'visitor')).toBe('test');
    expect(dropReason(req(), { wd: true }, 'visitor')).toBe('automation');
    expect(dropReason(req(undefined, { 'user-agent': 'Mozilla/5.0 HeadlessChrome/130.0' }), {}, 'visitor')).toBe('bot');
    expect(dropReason(req(undefined, { 'user-agent': 'facebookexternalhit/1.1' }), {}, 'visitor')).toBe('bot');
    expect(dropReason(req(), {}, 'internal')).toBe('internal');
    expect(dropReason(req(), {}, 'visitor')).toBeNull();
    expect(dropReason(req('radiology.monster'), {}, 'account')).toBeNull();
  });

  it('stores country, device and OS but never the IP, the user agent or the account id', async () => {
    const r = await ingestEvents(req(), batch([[Date.now(), 'land', { path: '/' }]], { tag: 'meta:reel002:h1', et: '4g' }), 'account', 'user-123');
    expect(r.kept).toBe(true);
    const [key] = [...fake.lists.keys()];
    expect(key).toMatch(/^rvm:ev:\d{4}-\d{2}-\d{2}$/);
    expect(fake.expires.get(key)).toBe(90 * 86_400);
    const raw = fake.lists.get(key)![0];
    const row = JSON.parse(raw);
    expect(row).toMatchObject({ vid: VID, sid: SID, c: 'IN', d: 'phone', os: 'android', et: '4g', tag: 'meta:reel002:h1', a: accountHash('user-123') });
    expect(raw).not.toContain('203.0.113.9');
    expect(raw).not.toContain('Pixel 7');
    expect(raw).not.toContain('user-123');
  });

  it('keeps nothing that is dropped, invalid or over the rate limit', async () => {
    expect((await ingestEvents(req('localhost'), batch([[1, 'land']]), 'visitor')).kept).toBe(false);
    expect((await ingestEvents(req(), { junk: true }, 'visitor')).reason).toBe('invalid');
    fake.allow = false;
    expect((await ingestEvents(req(), batch([[1, 'land']]), 'visitor')).reason).toBe('rate');
    expect(fake.lists.size).toBe(0);
  });

  it('hashes an account with the server secret: stable, short, and not the id', () => {
    expect(accountHash('user-1')).toBe(accountHash('user-1'));
    expect(accountHash('user-1')).not.toBe(accountHash('user-2'));
    expect(accountHash('user-1')).toMatch(/^[\w-]{16}$/);
    const before = accountHash('user-1');
    vi.stubEnv('EVENT_SALT', 'another-secret');
    expect(accountHash('user-1')).not.toBe(before); // useless without the server's secret
    vi.unstubAllEnvs();
  });

  it('reads the device class and OS family', () => {
    expect(device(PHONE)).toEqual({ d: 'phone', os: 'android' });
    expect(device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toEqual({ d: 'phone', os: 'ios' });
    expect(device('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)').d).toBe('tablet');
    expect(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0')).toEqual({ d: 'desktop', os: 'windows' });
  });
});

describe('Journeys', () => {
  const t0 = Date.parse('2026-11-07T10:00:00Z');
  const A = 'visitoraaaaaaaaa';
  const B = 'visitorbbbbbbbbb';
  const acct = accountHash('user-a');
  const batches = [
    { vid: A, sid: 'sa', c: 'IN', d: 'phone', et: '4g', tag: 'meta:reel002:h1', ev: [[t0, 'land', { path: '/read/x' }], [t0 + 1000, 'active', { kind: 'pointerdown' }], [t0 + 9000, 'first_image', { ms: 9000 }], [t0 + 15000, 'mark', {}], [t0 + 20000, 'answer', { correct: true }]] },
    { vid: A, sid: 'sa', a: acct, c: 'IN', d: 'phone', et: '4g', tag: 'meta:reel002:h1', ev: [[t0 + 60000, 'account', { new: true }], [t0 + 90000, 'plans_view', {}], [t0 + 95000, 'leave', { path: '/', last: 'plans_view' }]] },
    { a: acct, srv: 1 as const, ev: [[t0 + 93000, 'checkout_created', { tier: 'yearly' }]] },
    { vid: B, sid: 'sb', c: 'PK', d: 'phone', et: '3g', tag: 'meta:131slices:b_inpkph', ev: [[t0, 'land', { path: '/read/x' }], [t0 + 30000, 'leave', { path: '/read/x', last: 'land' }]] },
  ] as Parameters<typeof flatten>[0];

  it('counts each step once per visitor, with times from their first event, joining server events by account', () => {
    const r = journeys(flatten(batches, {}), t0);
    const step = (s: string) => r.funnel.find((x) => x.step === s)!;
    expect(step('land').visitors).toBe(2);
    expect(step('first_image')).toMatchObject({ visitors: 1, ofPrevious: 50, medianS: 9 });
    expect(step('answer').visitors).toBe(1);
    expect(step('checkout_created')).toMatchObject({ visitors: 1, medianS: 93 });
    expect(r.funnel.map((x) => x.step)).toEqual([...FUNNEL_STEPS]);
    expect(r.leaves[0][1]).toBe(1);
    expect(r.cohorts).toEqual([{ day: '2026-11-07', accounts: 1, studiedDay1: 0, returned2to7: 0, plans7: 1, paid7: 0 }]);
    expect(r.speed.firstImage).toMatchObject({ n: 1, p50: 9000 });
  });

  it('filters whole journeys by country, tag and people only', () => {
    expect(journeys(flatten(batches, { country: 'PK' }), t0).visitors).toBe(1);
    expect(journeys(flatten(batches, { tag: 'meta:reel002' }), t0).visitors).toBe(1);
    // B never touched the page: "people only" leaves A.
    expect(journeys(flatten(batches, { humans: true }), t0).funnel[0].visitors).toBe(1);
  });

  it('caps ranges and computes quantiles', () => {
    expect(dayRange('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(dayRange('2026-01-01', '2026-12-31')).toHaveLength(31);
    expect(dayRange('bad', '2026-11-03')).toEqual([]);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNull();
  });

  it('logs server events against the account hash only', async () => {
    await logServerEvent('checkout_created', 'user-a', { tier: 'yearly', regional: true });
    const row = JSON.parse([...fake.lists.values()][0][0]);
    expect(row).toMatchObject({ a: acct, srv: 1 });
    expect(JSON.stringify(row)).not.toContain('user-a');
  });
});

describe('experiments', () => {
  it('give a visitor the same arm every time, split about evenly, and none runs without a written plan', () => {
    expect(armFor(VID, 'landing_mode', ['a', 'b'])).toBe(armFor(VID, 'landing_mode', ['a', 'b']));
    const n = Array.from({ length: 4000 }, (_, i) => armFor(`v${i}`, 'x', ['a', 'b'])).filter((a) => a === 'a').length;
    expect(n).toBeGreaterThan(1850);
    expect(n).toBeLessThan(2150);
    expect(unitHash('abc')).toBeGreaterThanOrEqual(0);
    for (const [id, x] of Object.entries(EXPERIMENTS)) {
      expect(x.plan.length, id).toBeGreaterThan(60);
      expect(x.active, id).toBe(false); // each starts only after Kerim's yes
    }
  });
});
