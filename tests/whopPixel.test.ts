/**
 * The Whop Ads pixel counts visitors for Whop's analytics and ad attribution. It must run only on the real site and
 * never in an automated browser: in the first week of November localhost, dev servers and every Playwright run made
 * 2.4k of Whop's 3k "visitors" (all "Bosnia, desktop").
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const snippet = /<script>([^<]*whop\.track\("page"\)[^<]*)<\/script>/.exec(html)?.[1] ?? '';

/** Runs the page's pixel snippet in a fake page; true when it loaded Whop's script. */
function loadsPixel(hostname: string, webdriver = false): boolean {
  const inserted: string[] = [];
  const first = { parentNode: { insertBefore: (el: { src: string }) => inserted.push(el.src) } };
  const document = { createElement: () => ({ src: '', async: 0 }), getElementsByTagName: () => [first] };
  // As in a browser, `window` is the global object (the snippet sets window.whop, then calls whop.track).
  const page: Record<string, unknown> = { document, location: { hostname }, navigator: { webdriver }, Date };
  page.window = page;
  runInNewContext(snippet, page, { timeout: 1000 });
  return inserted.some((src) => src === 'https://t.whop.tw/s.js');
}

describe('the Whop pixel', () => {
  it('is in the page once', () => {
    expect(snippet).toContain('whop.setScope("biz_ZgHTgJ7Y6RQn4j")');
    expect(html.match(/t\.whop\.tw/g)).toHaveLength(1);
  });

  it('runs on radiology.monster', () => {
    expect(loadsPixel('www.radiology.monster')).toBe(true);
    expect(loadsPixel('radiology.monster')).toBe(true);
  });

  it('never runs on localhost, previews, look-alike hosts or in an automated browser', () => {
    for (const host of ['localhost', '127.0.0.1', 'radiology-git-main-kerim.vercel.app', 'radiology.monster.evil.com', 'xradiology.monster'])
      expect(loadsPixel(host), host).toBe(false);
    expect(loadsPixel('www.radiology.monster', true)).toBe(false);
  });
});
