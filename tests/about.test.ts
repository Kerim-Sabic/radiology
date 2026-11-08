import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fact, LANDING_FACTS } from '../src/auth/landingFacts';
import { MAKER } from '../src/lib/provenance';

const root = join(__dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const about = read('public/about.html');
const index = read('index.html');
const ld = (html: string, id?: string) =>
  JSON.parse(new RegExp(`<script type="application/ld\\+json"${id ? ` id="${id}"` : ''}>([\\s\\S]*?)</script>`).exec(html)![1])['@graph'] as Array<Record<string, any>>;
const HORALIX = 'https://horalix.com/#organization';

describe('/about: who makes Radiology Monster, readable without JavaScript', () => {
  it('is served at /about (a rewrite before the app catch-all) and listed in the sitemap', () => {
    const rewrites = JSON.parse(read('vercel.json')).rewrites as Array<{ source: string; destination: string }>;
    const at = rewrites.findIndex((r) => r.source === '/about' && r.destination === '/about.html');
    const catchAll = rewrites.findIndex((r) => r.destination === '/index.html');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(catchAll);
    expect(read('public/sitemap.xml')).toContain('<loc>https://www.radiology.monster/about</loc>');
    expect(about).toContain('<link rel="canonical" href="https://www.radiology.monster/about">');
    expect(about).toContain('<meta name="author" content="Horalix">');
    expect(about).not.toMatch(/noindex/);
  });

  it('marks up as FAQ only the questions the page answers, word for word', () => {
    const graph = ld(about);
    const faq = graph.find((g) => g['@type'] === 'FAQPage')!;
    const headings = [...about.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    for (const q of faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>) {
      expect(headings).toContain(q.name);
      // The answer's first sentence is on the page (links and markup aside).
      const first = q.acceptedAnswer.text.split('. ')[0].replace(/ \(https:\/\/horalix\.com\)/, '');
      expect(about.replace(/<[^>]+>/g, '')).toContain(first);
    }
    expect(graph.find((g) => g['@type'] === 'AboutPage')).toMatchObject({ author: { '@id': HORALIX }, publisher: { '@id': HORALIX } });
  });

  it('states only numbers the catalogue backs, and keeps the not-for-diagnosis line', () => {
    expect(about).toContain(`${fact(LANDING_FACTS.patients)}+ real, de-identified patients`);
    expect(about).toContain(`${fact(LANDING_FACTS.tasks)}+ graded image tasks`);
    expect(about).toContain('It is not a medical device and must not be used for clinical decisions.');
    // AI outlines are never presented as reviewed, and the drills that use them are named.
    expect(about).toContain('it has not been reviewed by a radiologist');
    for (const m of about.matchAll(/(\w+ \w+) reviewed by a radiologist/g)) expect(m[1]).toBe('not been');
    expect(about).toContain('Anatomy drills use it too');
    // No Radiopaedia or RSNA images are listed as sources.
    expect(about).not.toMatch(/radiopaedia|rsna/i);
  });
});

describe('made by Horalix, for search and answer engines', () => {
  it('makes Horalix the creator, publisher and provider of the site and the app, and Radiology Monster its brand', () => {
    const graph = ld(index, 'site-ld');
    const ref = { '@id': HORALIX };
    for (const type of ['WebSite', 'WebApplication']) expect(graph.find((g) => g['@type'] === type)).toMatchObject({ creator: ref, publisher: ref, provider: ref });
    const horalix = graph.find((g) => g['@id'] === HORALIX)!;
    expect(horalix).toMatchObject({ '@type': 'Organization', name: 'Horalix', url: MAKER.url, brand: { '@id': 'https://www.radiology.monster/#organization' } });
    expect(horalix.logo.url).toBe('https://horalix.com/brand/horalix-icon-512.png');
    expect(graph.find((g) => g['@id'] === 'https://www.radiology.monster/#organization')).toMatchObject({ parentOrganization: ref });
    expect(index).toContain('<meta name="author" content="Horalix" />');
  });

  it('answers "Who makes Radiology Monster?" the same way on the landing page, in the JSON-LD, without JS and in llms.txt', () => {
    const faq = ld(index, 'site-ld').find((g) => g['@type'] === 'FAQPage')!;
    const q = (faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>).find((x) => x.name === 'Who makes Radiology Monster?')!;
    expect(q.acceptedAnswer.text.startsWith(MAKER.line)).toBe(true);
    expect(read('src/auth/Landing.tsx')).toContain("'Who makes Radiology Monster?'");
    expect(/<noscript>[\s\S]*Who makes Radiology Monster\?[\s\S]*<\/noscript>/.test(index)).toBe(true);
    const llms = read('public/llms.txt');
    expect(llms.split('\n').find((l) => l.startsWith('> '))).toContain('is made by Horalix (https://horalix.com), a medical AI company in Sarajevo.');
    expect(llms).toContain('## Who makes it');
  });
});
