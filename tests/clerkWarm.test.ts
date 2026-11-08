/**
 * After a guest's graded answer the sign-up form's Clerk files are fetched ahead (src/auth/InlineAccount.tsx warmClerk):
 * the same URLs @clerk/react asks for, then the exact versions they redirect to, which the form then loads directly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clerkJSScriptUrl, clerkUIScriptUrl } from '@clerk/shared/loadClerkJsScript';

const HOST = 'https://clerk.www.radiology.monster';
const KEY = `pk_live_${Buffer.from('clerk.www.radiology.monster$').toString('base64')}`;
const JS = `${HOST}/npm/@clerk/clerk-js@6.41.0/dist/clerk.browser.js`;
const UI = `${HOST}/npm/@clerk/ui@1.42.0/dist/ui.browser.js`;
// The parts of ui.browser.js the warm-up reads: the chunk map and the build hash.
const UI_TEXT = 'n={26:"framework",1545:"vendors",472:"signup",6666:"ui-common",8010:"signin"}[e]||e)+"_ui_"+i.h().slice(0,6)+"_1.42.0.js",i.h=()=>"8f3fa6b185a90f70"';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A browser with Clerk's host answering the version tags with the exact files. */
function browser(saveData = false) {
  const fetched: Array<{ url: string; init?: RequestInit }> = [];
  const prefetched: string[] = [];
  vi.stubGlobal('navigator', { connection: { saveData } });
  vi.stubGlobal('document', {
    createElement: () => ({ relList: { supports: (t: string) => t === 'prefetch' } }),
    head: { appendChild: (l: { rel: string; href: string }) => l.rel === 'prefetch' && prefetched.push(l.href) },
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetched.push({ url, init });
    const exact = url.includes('clerk-js@6/') ? JS : url.includes('ui@1/') ? UI : url;
    return { ok: true, url: exact, text: async () => (exact === UI ? UI_TEXT : 'clerk') };
  });
  return { fetched, prefetched };
}

describe('the sign-up form’s Clerk files, fetched after a guest’s answer', () => {
  it('asks for exactly the URLs @clerk/react asks for', async () => {
    const { clerkScriptTags } = await import('../src/auth/InlineAccount');
    expect(clerkScriptTags(HOST)).toEqual({ js: clerkJSScriptUrl({ publishableKey: KEY }), ui: clerkUIScriptUrl({ publishableKey: KEY }) });
    // And Clerk's loader takes an exact URL in their place.
    expect(clerkJSScriptUrl({ publishableKey: KEY, __internal_clerkJSUrl: JS })).toBe(JS);
    expect(clerkUIScriptUrl({ publishableKey: KEY, __internal_clerkUIUrl: UI })).toBe(UI);
  });

  it('@clerk/react passes the exact URLs to that loader', () => {
    const dist = 'node_modules/@clerk/react/dist';
    const provider = readdirSync(dist).filter((f) => /^ClerkProvider-.*\.mjs$/.test(f)).map((f) => readFileSync(`${dist}/${f}`, 'utf8')).join('\n');
    expect(provider).toContain('this.options.__internal_clerkJSUrl');
    expect(provider).toContain('this.options.__internal_clerkUIUrl');
  });

  it('downloads both scripts at low priority, keeps their exact versions, and prefetches the form’s parts', async () => {
    const { fetched, prefetched } = browser();
    const m = await import('../src/auth/InlineAccount');
    expect(m.scriptUrls()).toEqual({});
    m.warmClerk(HOST);
    m.warmClerk(HOST); // once per page
    await vi.waitFor(() => expect(prefetched).toHaveLength(4));
    expect(fetched.map((f) => f.url)).toEqual([`${HOST}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, `${HOST}/npm/@clerk/ui@1/dist/ui.browser.js`]);
    expect(fetched.every((f) => f.init?.priority === 'low')).toBe(true);
    expect(prefetched).toEqual(['framework', 'vendors', 'ui-common', 'signup'].map((n) => `${HOST}/npm/@clerk/ui@1.42.0/dist/${n}_ui_8f3fa6_1.42.0.js`));
    expect(m.scriptUrls()).toEqual({ __internal_clerkJSUrl: JS, __internal_clerkUIUrl: UI });
  });

  it('fetches nothing for a visitor saving data, or without a Clerk host', async () => {
    const { fetched, prefetched } = browser(true);
    const m = await import('../src/auth/InlineAccount');
    m.warmClerk(HOST);
    m.warmClerk(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetched).toEqual([]);
    expect(prefetched).toEqual([]);
    expect(m.scriptUrls()).toEqual({});
  });
});
