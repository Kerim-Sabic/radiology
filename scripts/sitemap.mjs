// Writes public/sitemap.xml: the main pages, every course chapter and every condition page.
//   node scripts/sitemap.mjs
// tests/sitemap.test.ts fails when a condition or chapter is missing, so re-run this after adding one.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://www.radiology.monster';

const conditions = [...readFileSync(`${root}src/content/conditions.ts`, 'utf8').matchAll(/^ {4}id: '([a-z0-9_]+)',$/gm)].map((m) => m[1]);
const units = JSON.parse(readFileSync(`${root}public/content/curriculum.v1.json`, 'utf8')).units.map((u) => u.id);

const urls = [
  ['/', '1.0'],
  ['/cases', '0.9'],
  ['/conditions', '0.9'],
  ['/atlas', '0.8'],
  ['/drill', '0.7'],
  ['/course', '0.8'],
  ['/guide', '0.5'],
  ...units.map((u) => [`/course/${u}`, '0.6']),
  ...conditions.map((c) => [`/conditions?c=${c}`, '0.7']),
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([path, priority]) => `  <url><loc>${SITE}${path}</loc><priority>${priority}</priority></url>`).join('\n')}
</urlset>
`;
writeFileSync(`${root}public/sitemap.xml`, xml);
console.log(`sitemap.xml: ${urls.length} pages (${units.length} chapters, ${conditions.length} conditions)`);
