import { describe, expect, it } from 'vitest';
import { AUTO_RELOAD_KEY, AUTO_RELOAD_WINDOW_MS, describeError, errorDetails, errorMessage, isStaleRelease, mayAutoReload, reloadOnceForNewRelease, willReloadFor } from '../src/app/errorReport';

describe('error screen wording', () => {
  it('recognises a code file that failed to download after a release', () => {
    expect(isStaleRelease('Failed to fetch dynamically imported module: https://www.radiology.monster/assets/Workstation-abc.js')).toBe(true);
    expect(isStaleRelease('Importing a module script failed.')).toBe(true);
    expect(isStaleRelease('Unable to preload CSS for /assets/Book-1.css')).toBe(true);
    expect(isStaleRelease("Cannot read properties of undefined (reading 'x')")).toBe(false);
  });

  it('says a page did not finish loading, and offers the latest version', () => {
    const c = describeError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'), 'page');
    expect(c.kind).toBe('stale');
    expect(c.title).toBe('This page didn’t finish loading');
    expect(c.body).toMatch(/updated while this tab was open/);
    expect(describeError(new TypeError('Importing a module script failed.'), 'app').title).toBe('Radiology Monster didn’t finish loading');
  });

  it('says offline when the browser is offline or the request failed on the network', () => {
    expect(describeError(new Error('boom'), 'app', false).kind).toBe('offline');
    expect(describeError(new TypeError('Failed to fetch'), 'page').title).toBe('You seem to be offline');
  });

  it('names a crash plainly and keeps the reassurance that answers are kept', () => {
    const c = describeError(new TypeError("Cannot read properties of undefined (reading 'x')"), 'app');
    expect(c).toMatchObject({ kind: 'crash', title: 'Radiology Monster hit a problem', tag: 'Image not rendered' });
    expect(c.body).toMatch(/Answers you submitted are kept/);
    expect(describeError('weird', 'page').title).toBe('This page hit a problem');
  });

  it('shows the error type and message, whatever was thrown', () => {
    expect(errorMessage(new RangeError('bad slice'))).toBe('RangeError: bad slice');
    expect(errorMessage('plain text')).toBe('plain text');
    expect(errorMessage({ code: 7 })).toBe('{"code":7}');
  });

  it('copies the message, page, time, browser and the top of the stack, without the query string', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at a (x.js:1:1)\n    at b (y.js:2:2)';
    const text = errorDetails(err, { url: 'https://www.radiology.monster/read/case-1?task=secret&code=ABC', userAgent: 'UA/1', at: new Date('2026-11-06T20:00:00Z') });
    expect(text).toContain('Error: boom');
    expect(text).toContain('Page: https://www.radiology.monster/read/case-1');
    expect(text).not.toContain('secret');
    expect(text).toContain('Time: 2026-11-06T20:00:00.000Z');
    expect(text).toContain('Browser: UA/1');
    expect(text).toContain('at a (x.js:1:1)');
  });
});

describe('automatic reload after a failed code download', () => {
  it('reloads the first time, then not again within a minute (no reload loop)', () => {
    const now = 1_000_000;
    expect(mayAutoReload(null, now)).toBe(true);
    expect(mayAutoReload(String(now - 5_000), now)).toBe(false);
    expect(mayAutoReload(String(now - AUTO_RELOAD_WINDOW_MS - 1), now)).toBe(true);
    expect(mayAutoReload('garbage', now)).toBe(true);
  });

  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const stale = new TypeError('Failed to fetch dynamically imported module: /assets/Course-x.js');

  it('a boundary reloads for a stale code file once, and never for an ordinary crash', () => {
    const s = store();
    expect(willReloadFor(stale, s, 1_000)).toBe(true);
    expect(willReloadFor(new TypeError('x is undefined'), s, 1_000)).toBe(false);
    expect(willReloadFor(stale, null, 1_000)).toBe(false);
    let reloads = 0;
    expect(reloadOnceForNewRelease(s, () => (reloads += 1), 1_000)).toBe(true);
    expect(s.m.get(AUTO_RELOAD_KEY)).toBe('1000');
    // The reloaded tab fails again within the minute: the error screen shows instead of another reload.
    expect(willReloadFor(stale, s, 20_000)).toBe(false);
    expect(reloadOnceForNewRelease(s, () => (reloads += 1), 20_000)).toBe(false);
    expect(reloads).toBe(1);
  });

  it('blocked storage means no automatic reload (no loop risk)', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(willReloadFor(stale, blocked, 1)).toBe(false);
    expect(reloadOnceForNewRelease(blocked, () => { throw new Error('must not reload'); }, 1)).toBe(false);
  });
});
