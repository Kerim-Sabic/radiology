import { describe, expect, it } from 'vitest';
import { certificateImage, certificatePageHtml } from '../server/certificateShare';

const cert = { id: 'abcDEF123_-x', name: 'Ada "Ace" <Lovelace>', area: 'chest', level: 2 as const, title: 'Chest imaging', patients: 14, judged: 22, accuracy: 0.82, issuedAt: '2026-10-29T10:00:00.000Z' };
const index = `<!doctype html><html><head>
    <meta name="description" content="site" />
    <meta property="og:title" content="site" />
    <meta property="og:image" content="https://x/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <title>radiology.monster — Real cases.</title>
  </head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`;

describe('shared certificate links', () => {
  it('give link previews this certificate’s title, words and picture, safely escaped', () => {
    const html = certificatePageHtml(index, cert, 'https://www.radiology.monster', cert.id);
    expect(html).toContain('<meta property="og:image" content="https://www.radiology.monster/api/og/certificate?id=abcDEF123_-x" />');
    expect(html).toContain('<meta property="og:url" content="https://www.radiology.monster/certificate/abcDEF123_-x" />');
    expect(html).toContain('<title>Ada &quot;Ace&quot; &lt;Lovelace&gt; completed Chest imaging, Level 2 · Proficient · radiology.monster</title>');
    expect(html).toContain('14 real patients');
    expect(html).not.toContain('<Lovelace>');
    // The site-wide tags are replaced, not duplicated, and the app still boots.
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('content="site"');
    expect(html).toContain('<script type="module" src="/assets/index.js"></script>');
    // An unknown id still serves the app (which says so), with the site picture.
    expect(certificatePageHtml(index, null, 'https://www.radiology.monster', 'nope')).toContain('og.png');
  });

  it('render a PNG for posts (1200×627) and a square one (1080×1080)', async () => {
    for (const [square, w, h] of [[false, 1200, 627], [true, 1080, 1080]] as const) {
      const r = await certificateImage(cert, 'https://www.radiology.monster', square);
      expect(r.headers.get('content-type')).toBe('image/png');
      const png = new Uint8Array(await r.arrayBuffer());
      expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      const view = new DataView(png.buffer);
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([w, h]); // IHDR width and height
    }
  }, 30_000);
});
