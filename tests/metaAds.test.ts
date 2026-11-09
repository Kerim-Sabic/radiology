import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the Redis calls the ad measurement uses.
const fake = vi.hoisted(() => ({ kv: new Map<string, unknown>(), events: [] as Array<{ name: string; props: Record<string, unknown> }> }));
vi.mock('../server/store', () => ({
  db: () => ({
    get: async (k: string) => fake.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && fake.kv.has(k)) return null;
      fake.kv.set(k, v);
      return 'OK';
    },
  }),
}));
vi.mock('../server/events', () => ({
  logServerEvent: async (_name: string, _user: string, props: Record<string, unknown>) => { fake.events.push({ name: _name, props }); },
}));

import { cleanConsent, eligiblePayment, purchaseEvent, recordPurchase, PURCHASE_MAX_AGE_MS, consentKey, browserPurchaseKey } from '../server/metaAds';
import { pixelHostAllowed, pixelPageAllowed, promptSuppressed } from '../src/services/metaPixel';

const NOW = Date.parse('2026-11-09T10:00:00Z');
const uid = 'b'.repeat(64);
const payment = { id: 'pay_abc123', status: 'paid', substatus: 'succeeded', paid_at: '2026-11-09T09:58:00Z', currency: 'inr', total: 281.4 };
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  fake.kv.clear();
  fake.events.length = 0;
  calls = [];
  vi.stubEnv('APP_URL', 'https://www.radiology.monster');
  vi.stubEnv('META_CAPI_TOKEN', 'test-token');
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: true };
  });
  fake.kv.set(`rvm:identity:${uid}`, { email: 'Learner@Example.com ', emailVerified: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('which payments count as a purchase', () => {
  it('only a paid, succeeded payment with an amount and a currency', () => {
    expect(eligiblePayment(payment, NOW)).toEqual({ value: 281.4, currency: 'INR', paidAt: Date.parse(payment.paid_at) });
    // Whop's SDK shape: the amount as money, an exact decimal string.
    expect(eligiblePayment({ ...payment, total: { amount: '281.40', currency: 'inr' }, currency: undefined }, NOW)).toEqual({ value: 281.4, currency: 'INR', paidAt: Date.parse(payment.paid_at) });
    expect(eligiblePayment({ ...payment, total: { amount: '9.99', currency: 'usd' }, currency: 'inr' }, NOW)).toMatchObject({ value: 9.99, currency: 'USD' });
    expect(eligiblePayment({ ...payment, total: { amount: 'abc', currency: 'usd' } }, NOW)).toBeNull();
    for (const bad of [{ status: 'open' }, { substatus: 'blocked' }, { substatus: 'partially_refunded' }, { total: 0 }, { total: null }, { currency: '' }, { currency: 'rupees' }, { paid_at: null }]) {
      expect(eligiblePayment({ ...payment, ...bad }, NOW)).toBeNull();
    }
  });
  it('not an old payment, and not one dated in the future', () => {
    expect(eligiblePayment({ ...payment, paid_at: new Date(NOW - PURCHASE_MAX_AGE_MS - 60_000).toISOString() }, NOW)).toBeNull();
    expect(eligiblePayment({ ...payment, paid_at: new Date(NOW + 2 * 3_600_000).toISOString() }, NOW)).toBeNull();
  });
});

describe('the consent a browser reports', () => {
  it('keeps a yes with Meta ids that look right, drops the rest, and a no carries nothing', () => {
    expect(cleanConsent({ ads: true, fbp: 'fb.1.1700000000000.1234567890', fbc: 'fb.1.1700000000000.AbC_-123' }, 5)).toEqual({ ads: true, fbp: 'fb.1.1700000000000.1234567890', fbc: 'fb.1.1700000000000.AbC_-123', at: 5 });
    expect(cleanConsent({ ads: true, fbp: 'not-a-cookie<script>', fbc: 'x' }, 5)).toEqual({ ads: true, at: 5 });
    expect(cleanConsent({ ads: false, fbp: 'fb.1.1700000000000.1234567890' }, 5)).toEqual({ ads: false, at: 5 });
    expect(cleanConsent({ ads: 'yes' })).toBeNull();
    expect(cleanConsent(null)).toBeNull();
  });
});

describe('the Conversions API event', () => {
  it('has the payment id as event id, the paid value and currency, hashed identifiers and only the home page address', () => {
    const e = purchaseEvent({ paymentId: payment.id, value: 281.4, currency: 'INR', paidAt: NOW, email: 'Learner@Example.com ', userId: uid, planId: 'plan_x', consent: { ads: true, fbp: 'fb.1.1700000000000.1234567890', at: 1 } });
    expect(e).toMatchObject({ event_name: 'Purchase', event_id: 'pay_abc123', action_source: 'website', event_source_url: 'https://www.radiology.monster/', custom_data: { value: 281.4, currency: 'INR' } });
    expect(e.user_data.em?.[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(e)).not.toMatch(/learner|example\.com|read\/|task=/i);
  });
});

describe('recording a purchase', () => {
  it('sends once for a consenting buyer, with no replay on a refresh or a second check', async () => {
    fake.kv.set(consentKey(uid), { ads: true, at: 1 });
    await recordPurchase(uid, payment, 'plan_x', NOW);
    await recordPurchase(uid, payment, 'plan_x', NOW);
    await recordPurchase(uid, payment, 'plan_x', NOW + 5000);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/2330256791086004/events');
    expect(fake.kv.get(browserPurchaseKey(uid))).toEqual({ id: 'pay_abc123', value: 281.4, currency: 'INR' });
    expect(fake.events.filter((x) => x.name === 'purchase')).toHaveLength(1);
    expect(fake.events[0].props).toMatchObject({ value: 281.4, currency: 'INR', capi: true, browser: true, why: 'sent' });
  });
  it('sends nothing without the visitor\'s yes, and does not look at that payment again', async () => {
    await recordPurchase(uid, payment, 'plan_x', NOW);
    fake.kv.set(consentKey(uid), { ads: true, at: 1 });
    await recordPurchase(uid, payment, 'plan_x', NOW);
    expect(calls).toHaveLength(0);
    expect(fake.kv.has(browserPurchaseKey(uid))).toBe(false);
    expect(fake.events[0].props).toMatchObject({ why: 'no_consent', capi: false, browser: false });
  });
  it('sends nothing for a payment that is not paid and succeeded', async () => {
    fake.kv.set(consentKey(uid), { ads: true, at: 1 });
    await recordPurchase(uid, { ...payment, status: 'open', substatus: 'blocked' }, 'plan_x', NOW);
    expect(calls).toHaveLength(0);
    expect(fake.events).toHaveLength(0);
  });
  it('without a token the browser copy is still queued, and the log says why the server copy did not go', async () => {
    vi.stubEnv('META_CAPI_TOKEN', '');
    fake.kv.set(consentKey(uid), { ads: true, at: 1 });
    await recordPurchase(uid, payment, 'plan_x', NOW);
    expect(calls).toHaveLength(0);
    expect(fake.kv.get(browserPurchaseKey(uid))).toBeTruthy();
    expect(fake.events[0].props).toMatchObject({ capi: false, browser: true, why: 'no_token' });
  });
  it('marks a test run when Meta\'s test code is set, and passes the code on', async () => {
    vi.stubEnv('META_TEST_EVENT_CODE', 'TEST12345');
    fake.kv.set(consentKey(uid), { ads: true, at: 1 });
    await recordPurchase(uid, payment, 'plan_x', NOW);
    expect(calls[0].body.test_event_code).toBe('TEST12345');
    expect(fake.events[0].props.test).toBe(true);
  });
  it('a failed send never throws and never blocks', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network'); });
    fake.kv.set(consentKey(uid), { ads: true, at: 1 });
    await expect(recordPurchase(uid, payment, 'plan_x', NOW)).resolves.toBeUndefined();
    expect(fake.events[0].props).toMatchObject({ capi: false, why: 'capi_failed' });
  });
  it('never puts the token in the logged event', async () => {
    fake.kv.set(consentKey(uid), { ads: true, at: 1 });
    await recordPurchase(uid, payment, 'plan_x', NOW);
    expect(JSON.stringify(fake.events)).not.toContain('test-token');
  });
});

describe('the pages the Pixel may see', () => {
  it('the home page, About and Cases with campaign tags only; never a case, a task, a code or the atlas', () => {
    expect(pixelPageAllowed('/', '')).toBe(true);
    expect(pixelPageAllowed('/', '?utm_source=instagram&utm_campaign=mkt&fbclid=abc&checkout=returned')).toBe(true);
    expect(pixelPageAllowed('/about/', '')).toBe(true);
    expect(pixelPageAllowed('/cases', '')).toBe(true);
    for (const [p, s] of [['/read/cxr-00003400-003', '?task=cxr-00003400-003%3Alocate&mode=practice'], ['/', '?task=heart'], ['/', '?code=WELCOME-4F3RM'], ['/atlas', ''], ['/course/ch02', ''], ['/progress', ''], ['/admin', ''], ['/certificate/abc', '']] as const) {
      expect(pixelPageAllowed(p, s)).toBe(false);
    }
  });
  it('only the real site reports: not localhost, a preview deployment or a look-alike host', () => {
    for (const h of ['radiology.monster', 'www.radiology.monster']) expect(pixelHostAllowed(h)).toBe(true);
    for (const h of ['localhost', '127.0.0.1', 'radiology-monster-git-x.vercel.app', 'radiology.monster.evil.com', 'evilradiology.monster']) expect(pixelHostAllowed(h)).toBe(false);
  });
  it('the consent prompt stays off a case, a certificate and the admin page', () => {
    for (const p of ['/read/starter-ct-chest-01', '/study/x', '/certificate/abc', '/verify/abc', '/admin']) expect(promptSuppressed(p)).toBe(true);
    for (const p of ['/', '/cases', '/about', '/settings']) expect(promptSuppressed(p)).toBe(false);
  });
});
