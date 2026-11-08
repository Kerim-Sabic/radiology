/**
 * What the app promises a guest before sign-up stays true: the welcome gift's numbers are the server's, a welcome code
 * is recognised the way the server makes it, and the "both free patients" are a chest X-ray and a chest CT.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/store', () => ({ db: () => ({}) }));

import { OFFER_DELAY_HOURS, WELCOME_HOURS, WELCOME_PERCENT, WELCOME_PREFIX } from '../server/welcomeCode';
import { isWelcomeCode, WELCOME_GIFT } from '../src/auth/welcomeOffer';
import { FREE_CASES } from '../src/content/weekly';

describe('the sign-up promise', () => {
  it('quotes the welcome gift the server sends: 40% off, a day after sign-up, for 72 hours', () => {
    expect(WELCOME_GIFT).toEqual({ percent: WELCOME_PERCENT, afterHours: OFFER_DELAY_HOURS, hours: WELCOME_HOURS });
    expect(WELCOME_GIFT.afterHours).toBe(24); // the copy says "a day after you join"
  });

  it('recognises a welcome code as the server makes it, in any case, and nothing else', () => {
    expect(isWelcomeCode(`${WELCOME_PREFIX}ana-k7q3m`)).toBe(true);
    expect(isWelcomeCode(' WELCOME-TEST ')).toBe(true);
    expect(isWelcomeCode('student30')).toBe(false);
    expect(isWelcomeCode('')).toBe(false);
  });

  it('names the free patients for what they are: a chest X-ray and a chest CT', () => {
    const titles = FREE_CASES.map((id) => {
      for (const pack of ['starter', 'cxr-findings']) {
        const lessons = JSON.parse(readFileSync(`public/packs/${pack}/lessons.json`, 'utf8')) as { cases: Array<{ id: string; neutralTitle: string }> };
        const found = lessons.cases.find((c) => c.id === id);
        if (found) return found.neutralTitle;
      }
      return null;
    });
    expect(titles).toHaveLength(2);
    expect(titles.some((t) => /Chest radiograph/.test(t ?? ''))).toBe(true);
    expect(titles.some((t) => /CT chest/.test(t ?? ''))).toBe(true);
  });
});
