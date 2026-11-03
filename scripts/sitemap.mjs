// Writes public/sitemap.xml: only the pages a signed-out visitor (and a search engine) can actually read.
//   node scripts/sitemap.mjs
// The study pages (cases, conditions, course chapters) need an account: signed out they show the home page with the
// home page's canonical, so listing them only gives search engines duplicates of the home page. Add a page here
// when it becomes public with its own content and canonical (tests/sitemap.test.ts keeps the list honest).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://www.radiology.monster';
const today = new Date().toISOString().slice(0, 10);

const urls = [
  ['/', '1.0'],
  // The example certificate: a public, server-rendered page with its own title and canonical.
  ['/verify/example', '0.5'],
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([path, priority]) => `  <url><loc>${SITE}${path}</loc><lastmod>${today}</lastmod><priority>${priority}</priority></url>`).join('\n')}
</urlset>
`;
writeFileSync(`${root}public/sitemap.xml`, xml);
console.log(`sitemap.xml: ${urls.length} public pages`);
