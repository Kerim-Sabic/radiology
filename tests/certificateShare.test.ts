import { describe, expect, it } from 'vitest';
import { certificateImage, certificatePageHtml } from '../server/certificateShare';

const cert = { id: 'abcDEF123_-x', name: 'Ada "Ace" <Lovelace>', area: 'chest', level: 2 as const, title: 'Chest Imaging', patients: 14, judged: 22, accuracy: 0.82, issuedAt: '2026-10-29T10:00:00.000Z' };
const index = `<!doctype html><html><head>
    <meta name="description" content="site" />
    <meta property="og:title" content="site" />
    <meta property="og:image" content="https://x/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <title>radiology.monster — Real cases.</title>
    <link rel="canonical" href="https://www.radiology.monster/" />
    <script type="application/ld+json" id="site-ld">
      { "@context": "https://schema.org", "@type": "WebSite" }
    </script>
  </head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`;

describe('shared certificate links', () => {
  it('removes credential endorsement and earned image from revoked records',()=>{
    const html=certificatePageHtml(index,{...cert,status:'revoked'},'https://www.radiology.monster',cert.id);
    expect(html).toContain('Revoked certificate');
    expect(html).not.toContain('application/ld+json');
    expect(html).not.toContain('/api/og/certificate');
    expect(html).toContain('no longer valid');
  });
  it('give link previews this certificate’s title, words and picture, safely escaped', () => {
    const html = certificatePageHtml(index, cert, 'https://www.radiology.monster', cert.id);
    expect(html).toContain('<meta property="og:image" content="https://www.radiology.monster/api/og/certificate?id=abcDEF123_-x" />');
    expect(html).toContain('<meta property="og:url" content="https://www.radiology.monster/verify/abcDEF123_-x" />');
    expect(html).toContain('<title>Ada &quot;Ace&quot; &lt;Lovelace&gt; earned the Chest Imaging Certificate – Level 2 (Intermediate) · radiology.monster</title>');
    // Read as a credential: schema.org data, with nothing able to close the script early.
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]);
    expect(ld).toMatchObject({ '@type': 'EducationalOccupationalCredential', name: 'Chest Imaging Certificate – Level 2 (Intermediate)', educationalLevel: 'Intermediate', identifier: 'abcDEF123_-x' });
    expect(html).not.toMatch(/ld\+json">[^<]*<Lovelace/);
    expect(html).toContain('14 real patients');
    expect(html).not.toContain('<Lovelace>');
    // The site-wide tags are replaced, not duplicated, and the app still boots.
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('content="site"');
    expect(html).toContain('<script type="module" src="/assets/index.js"></script>');
    // The page has its own canonical address and credential data, not the landing page's.
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('<link rel="canonical" href="https://www.radiology.monster/verify/abcDEF123_-x" />');
    expect(html).not.toContain('id="site-ld"');
    // An unknown id still serves the app (which says so), with the site picture.
    expect(certificatePageHtml(index, null, 'https://www.radiology.monster', 'nope')).toContain('og.png');
  });

  it('say what an exam certificate records', () => {
    const exam = { ...cert, patients: 25, judged: 25, accuracy: 0.86, exam: { questions: 25, passMark: 0.8, secondsPerQuestion: 180, partialCredit: true } };
    const html = certificatePageHtml(index, exam, 'https://www.radiology.monster', exam.id);
    expect(html).toContain('Passed a 25-question exam on 25 real patients · 86% right (pass mark 80%)');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]);
    expect(ld.competencyRequired).toBe("An exam of 25 questions on real patients, 3 min each, without hints, each answer graded against the expert's reference; pass mark 80%");
    const top = { ...exam, level: 3 as const, exam: { questions: 40, passMark: 0.9, secondsPerQuestion: 120, partialCredit: false } };
    const topLd = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(certificatePageHtml(index, top, 'https://www.radiology.monster', top.id))![1]);
    expect(topLd.competencyRequired).toBe("An exam of 40 questions on real patients, 2 min each, without hints, each answer graded against the expert's reference; only fully right answers count; pass mark 90%");
  });

  it('render a PNG for posts (1200×627), a square one (1080×1080) and a story (1080×1920)', async () => {
    for (const [format, w, h] of [['wide', 1200, 627], ['square', 1080, 1080], ['story', 1080, 1920]] as const) {
      const r = await certificateImage(cert, 'https://www.radiology.monster', format);
      expect(r.headers.get('content-type')).toBe('image/png');
      const png = new Uint8Array(await r.arrayBuffer());
      expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      const view = new DataView(png.buffer);
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([w, h]); // IHDR width and height
    }
  }, 30_000);
});
