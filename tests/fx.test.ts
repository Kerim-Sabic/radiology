/**
 * "About ₹442": a dollar price read in the visitor's money from the ECB's daily rate. Never what is charged, never a
 * guess (no rate, a stale rate or a currency the ECB doesn't publish: nothing is shown), and never a wait on the network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));
vi.mock('../server/store', () => ({
  db: () => ({
    get: async (k: string) => fake.kv.get(k) ?? null,
    set: async (k: string, v: unknown) => fake.kv.set(k, v),
  }),
}));

import { localMoney, refreshFx } from '../server/fx';

// Background refreshes never reach the network in tests.
vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
import { aboutLocal } from '../src/auth/regionalPrice';

beforeEach(() => fake.kv.clear());

describe('the rate', () => {
  it('is read from the cache, for currencies the ECB publishes only', async () => {
    const now = Date.now();
    fake.kv.set('rvm:fx:usd', { at: now - 3_600_000, date: '2026-11-06', rates: { INR: 88.4, PHP: 58.1 } });
    expect(await localMoney('IN', now)).toEqual({ currency: 'INR', perUsd: 88.4, date: '2026-11-06' });
    expect(await localMoney('ph', now)).toMatchObject({ currency: 'PHP' });
    for (const c of ['PK', 'NG', 'EG', 'KE', 'BD', 'US', null]) expect(await localMoney(c, now), String(c)).toBeNull();
  });

  it('shows nothing when the rate is missing or old, and refreshes it in the background', async () => {
    const now = Date.now();
    expect(await localMoney('IN', now)).toBeNull();
    fake.kv.set('rvm:fx:usd', { at: now - 40 * 3_600_000, date: '2026-11-04', rates: { INR: 88 } });
    expect(await localMoney('IN', now)).toBeNull();
  });

  it('keeps only sane rates from the source, and keeps the old ones if the source fails', async () => {
    await refreshFx(); // let any background refresh from the tests above finish first
    const ok = vi.fn(async () => new Response(JSON.stringify({ date: '2026-11-07', rates: { INR: 88.5, BAD: -1, XX: 'no', PHP: 58 } })));
    await refreshFx(ok as unknown as typeof fetch);
    expect((fake.kv.get('rvm:fx:usd') as { rates: object }).rates).toEqual({ INR: 88.5, PHP: 58 });
    const down = vi.fn(async () => new Response('', { status: 503 }));
    await refreshFx(down as unknown as typeof fetch);
    expect((fake.kv.get('rvm:fx:usd') as { rates: object }).rates).toEqual({ INR: 88.5, PHP: 58 });
  });
});

describe('the amount shown', () => {
  it('rounds the way prices are read', () => {
    const inr = { currency: 'INR', perUsd: 88.4, date: '2026-11-07' };
    expect(aboutLocal(4.99, inr)).toBe('about ₹441');
    expect(aboutLocal(39.99, inr)).toBe('about ₹3,540');
    expect(aboutLocal(9.99, { currency: 'PHP', perUsd: 58.1, date: '' })).toMatch(/^about ₱580$/);
    expect(aboutLocal(4.99, undefined)).toBeNull();
  });
});
