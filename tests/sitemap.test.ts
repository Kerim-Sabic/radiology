import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '../src/content/conditions';

const root = join(__dirname, '..');
const sitemap = readFileSync(join(root, 'public/sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

describe('public site: sitemap and robots', () => {
  it('lists every condition page and only real conditions (re-run scripts/sitemap.mjs after adding one)', () => {
    const inMap = locs.filter((l) => l.includes('/conditions?c=')).map((l) => l.split('?c=')[1]);
    expect(new Set(inMap)).toEqual(new Set(CONDITIONS.map((c) => c.id)));
  });

  it('lists every course chapter', () => {
    const units = JSON.parse(readFileSync(join(root, 'public/content/curriculum.v1.json'), 'utf8')).units.map((u: { id: string }) => u.id);
    for (const u of units) expect(locs).toContain(`https://radiology.monster/course/${u}`);
  });

  it('keeps personal pages and the book reader out of search, and points to the sitemap', () => {
    const robots = readFileSync(join(root, 'public/robots.txt'), 'utf8');
    for (const p of ['/progress', '/import', '/settings', '/author', '/book']) expect(robots).toContain(`Disallow: ${p}`);
    expect(robots).toContain('Sitemap: https://radiology.monster/sitemap.xml');
    expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toMatch(/noindex/);
  });
});
