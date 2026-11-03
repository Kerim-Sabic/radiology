// Tells Bing (which ChatGPT search and Copilot read), Yandex and other IndexNow engines that the public pages changed.
//   node scripts/indexnow.mjs
// Run it after a deploy that changes public pages (the home page, llms.txt, the example certificate). The key is public by
// design: the engines fetch https://www.radiology.monster/<key>.txt to check the request comes from this site.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const HOST = 'www.radiology.monster';
const KEY = 'c5061eada849d4d690467554078dd81f';

const fromSitemap = [...readFileSync(`${root}public/sitemap.xml`, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const urlList = [...fromSitemap, `https://${HOST}/llms.txt`];

const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
});
// 200 or 202: accepted. 403: the key file is not live yet (deploy first).
console.log(`IndexNow: HTTP ${r.status} for ${urlList.length} URLs`);
