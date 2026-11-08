import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const sitemap = readFileSync(join(root, 'public/sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const index = readFileSync(join(root, 'index.html'), 'utf8');

describe('public site: sitemap, robots and the brand', () => {
  it('lists only pages a signed-out visitor can read (study pages need an account and show the home page)', () => {
    expect(locs).toEqual(['https://www.radiology.monster/', 'https://www.radiology.monster/about', 'https://www.radiology.monster/verify/example']);
  });

  it('keeps personal and private pages out of search, and points to the sitemap', () => {
    const robots = readFileSync(join(root, 'public/robots.txt'), 'utf8');
    for (const p of ['/progress', '/import', '/settings', '/author', '/book', '/admin', '/class', '/join/', '/packs/', '/content/', '/api/']) expect(robots).toContain(`Disallow: ${p}`);
    // One group for every crawler: AI crawlers read the public pages like search engines do (no group shuts them out).
    expect(robots.match(/^User-agent:/gm)).toEqual(['User-agent:']);
    expect(robots).toMatch(/^User-agent: \*\r?$/m);
    expect(robots).not.toMatch(/^Disallow: \/\r?$/m);
    expect(robots).toContain('Sitemap: https://www.radiology.monster/sitemap.xml');
    expect(index).not.toMatch(/noindex/);
  });

  it('names the site "Radiology Monster" everywhere a search engine or an AI reads it, with radiology.monster as its other name', () => {
    expect(index).toMatch(/<title>Radiology Monster · /);
    expect(index).toContain('<meta property="og:site_name" content="Radiology Monster" />');
    const graph = JSON.parse(/<script type="application\/ld\+json" id="site-ld">([\s\S]*?)<\/script>/.exec(index)![1])['@graph'] as Array<Record<string, unknown>>;
    const site = graph.find((g) => g['@type'] === 'WebSite')!;
    const org = graph.find((g) => g['@id'] === 'https://www.radiology.monster/#organization')!;
    const horalix = { '@id': 'https://horalix.com/#organization' };
    expect(site).toMatchObject({ name: 'Radiology Monster', url: 'https://www.radiology.monster/', creator: horalix, publisher: horalix, provider: horalix });
    expect(site.alternateName).toContain('radiology.monster');
    expect(org).toMatchObject({ '@type': 'Organization', name: 'Radiology Monster', alternateName: 'radiology.monster', logo: { url: 'https://www.radiology.monster/icon-512.png' } });
    // The prices answer engines quote come from the real plans.
    const app = graph.find((g) => g['@type'] === 'WebApplication') as { offers: Array<{ price: string }> };
    expect(app.offers.map((o) => o.price)).toEqual(['0', '20', '150']);
    const faq = graph.find((g) => g['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string }> };
    expect(faq.mainEntity[0].name).toBe('What is Radiology Monster?');
    // Crawlers that do not run JavaScript (most AI crawlers) read the same answers in plain HTML.
    expect(/<noscript>[\s\S]*What is Radiology Monster\?[\s\S]*How much does it cost\?[\s\S]*<\/noscript>/.test(index)).toBe(true);
    expect(readFileSync(join(root, 'public/llms.txt'), 'utf8')).toMatch(/^# Radiology Monster \(radiology\.monster\)/);
  });
});
