import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement as h, type ReactNode } from 'react';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { Certificate } from './certificates.js';
import { LEVEL_STYLE, credentialName, levelName, levelRequirement, levelRule, starPoints, type CertArea, type CertLevel } from '../shared/certificateLevels.js';

/**
 * What a shared certificate looks like outside the app: the picture LinkedIn, X, WhatsApp or Slack show for its
 * link (1200×627; 1080×1080 and 1080×1920 for posts and stories), and the page tags that point them to it.
 */

type FontEntry = { name: string; data: Buffer; weight: 400 | 600 | 700 | 800; style: 'normal' };
let fonts: FontEntry[] | null = null;
function loadFonts(): FontEntry[] {
  const f = (file: string) => readFileSync(new URL(`./fonts/${file}`, import.meta.url));
  fonts ??= [
    { name: 'Inter', data: f('Inter-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Inter', data: f('Inter-SemiBold.ttf'), weight: 600, style: 'normal' },
    { name: 'Jakarta', data: f('PlusJakartaSans-ExtraBold.ttf'), weight: 800, style: 'normal' },
    { name: 'Playfair', data: f('PlayfairDisplay-Bold.ttf'), weight: 700, style: 'normal' },
  ];
  return fonts;
}

// The logo as the app icon (the mark on its dark tile), which reads on the white certificate.
let brand: { icon: string } | null = null;
function loadBrand() {
  brand ??= { icon: `data:image/png;base64,${readFileSync(new URL('./brand/icon.png', import.meta.url)).toString('base64')}` };
  return brand;
}

// The PNG renderer is WebAssembly; it is loaded once per server instance.
let wasm: Promise<void> | null = null;
const renderer = () => (wasm ??= initWasm(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'))));

const issuedMonth = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const host = (origin: string) => origin.replace(/^https?:\/\//, '').replace(/^www\./, '');

type Style = Record<string, string | number>;
const box = (style: Style, ...children: ReactNode[]) => h('div', { style: { display: 'flex', ...style } }, ...children);
const text = (style: Style, value: string) => h('div', { style: { display: 'flex', ...style } }, value);

/** A round seal in the level's colour: ring, check mark and one to three stars. */
function seal(size: number, level: CertLevel) {
  const st = LEVEL_STYLE[level];
  const stars = [76, 100, 124].map((x, i) => h('polygon', { key: i, points: starPoints(x, 150, 10), fill: i < level ? st.accent : 'none', stroke: st.accent, strokeWidth: 2 }));
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 200 200' },
    h('defs', null, h('linearGradient', { id: `ring${level}`, x1: '0', y1: '0', x2: '1', y2: '1' }, h('stop', { offset: '0', stopColor: st.ring[0] }), h('stop', { offset: '1', stopColor: st.ring[1] }))),
    h('circle', { cx: 100, cy: 100, r: 92, fill: 'none', stroke: `url(#ring${level})`, strokeWidth: 10 }),
    h('circle', { cx: 100, cy: 100, r: 74, fill: st.soft, stroke: st.line, strokeWidth: 2, strokeDasharray: '4 6' }),
    h('path', { d: 'M66 94 L89 117 L134 72', fill: 'none', stroke: st.accent, strokeWidth: 14, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ...stars,
  );
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export type ImageFormat = 'wide' | 'square' | 'story';
const SIZES: Record<ImageFormat, [number, number]> = { wide: [1200, 627], square: [1080, 1080], story: [1080, 1920] };
// Type sizes and spacing per format: a link preview, a square post and a phone story.
const SCALE: Record<ImageFormat, { name: number; title: number; seal: number; base: number; frame: number; inner: string; gap: number }> = {
  wide: { name: 54, title: 32, seal: 100, base: 15, frame: 26, inner: '20px 44px 16px', gap: 2 },
  square: { name: 78, title: 48, seal: 170, base: 20, frame: 44, inner: '44px 52px 30px', gap: 18 },
  story: { name: 100, title: 62, seal: 270, base: 26, frame: 48, inner: '72px 56px 48px', gap: 34 },
};

/**
 * The certificate as a picture, laid out like a printed certificate: the issuer, "This certifies that", the name in a
 * serif, what was completed and at which level, the result, then the date of issue and the issuer on either side of
 * the seal, and the credential ID with its check address.
 */
export async function certificateImage(c: Certificate, origin: string, as: ImageFormat | boolean = 'wide'): Promise<Response> {
  // Only image requests need the font engine and its WebAssembly initialization.
  const { default: satori } = await import('satori');
  const format: ImageFormat = as === true ? 'square' : as === false ? 'wide' : as;
  const [width, height] = SIZES[format];
  const k = SCALE[format];
  const story = format === 'story';
  const level = (c.level ?? 1) as CertLevel;
  const st = LEVEL_STYLE[level];
  const logo = loadBrand();
  const unaided = levelRule((c.area as CertArea) ?? 'chest', level)?.independent ?? false;
  const nameSize = c.name.length > 26 ? Math.round(k.name * 0.78) : k.name;
  const small = (value: string, style: Style = {}) => text({ fontSize: k.base * 0.8, fontWeight: 600, letterSpacing: 2.5, color: '#6b7280', ...style }, value);
  const signature = (value: string, label: string) =>
    box(
      { flexDirection: 'column', alignItems: 'center', width: story ? 380 : format === 'square' ? 300 : 280 },
      text({ fontSize: k.base * 1.15, fontWeight: 600, color: '#111827', paddingBottom: 8 }, value),
      box({ width: '100%', height: 1.5, background: '#9ca3af' }),
      small(label, { marginTop: 8 }),
    );
  const levelLine = box(
    { alignItems: 'center', gap: 10, marginTop: 6 + k.gap / 2 },
    h(
      'svg',
      { width: k.base * 4.2, height: k.base * 1.3, viewBox: '0 0 66 20' },
      ...[10, 33, 56].map((x, i) => h('polygon', { key: i, points: starPoints(x, 10, 9), fill: i < level ? st.accent : 'none', stroke: st.accent, strokeWidth: 1.6 })),
    ),
    text({ fontSize: k.base * 1.05, fontWeight: 600, letterSpacing: 3, color: st.accent }, `LEVEL ${level} · ${levelName(level).toUpperCase()}`),
  );
  const result = `${c.patients} real patients read · ${c.judged} graded answers${unaided ? ' without hints' : ''} · ${Math.round(c.accuracy * 100)}% right`;
  const brandRow = box(
    { alignItems: 'center', gap: 12 },
    h('img', { src: logo.icon, width: k.base * 2.5, height: k.base * 2.5, style: { borderRadius: k.base * 0.6 } }),
    box({ fontFamily: 'Jakarta', fontSize: k.base * 1.6 }, text({ color: '#111827' }, 'radiology'), text({ color: '#1d4ed8' }, '.monster')),
  );
  const middle = box(
    { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', flexGrow: 1, paddingBottom: k.gap },
    text({ fontSize: k.base, fontWeight: 600, letterSpacing: 6, color: st.accent }, 'CERTIFICATE OF ACHIEVEMENT'),
    text({ marginTop: 8 + k.gap / 2, fontSize: k.base * 1.1, color: '#6b7280' }, 'This certifies that'),
    text({ marginTop: 2 + k.gap / 3, fontFamily: 'Playfair', fontSize: nameSize, lineHeight: 1.12, color: '#111827', justifyContent: 'center' }, c.name),
    box({ marginTop: 12 + k.gap / 2, width: k.base * 6, height: 2, background: st.accent }),
    text({ marginTop: 8 + k.gap / 2, fontSize: k.base * 1.1, color: '#4b5563' }, 'has successfully completed'),
    text({ marginTop: 2 + k.gap / 3, fontFamily: 'Jakarta', fontSize: k.title, color: '#111827', letterSpacing: -0.4, lineHeight: 1.15, justifyContent: 'center' }, c.title),
    levelLine,
    text({ marginTop: 6 + k.gap / 2, fontSize: k.base * 0.95, color: '#6b7280', justifyContent: 'center' }, result),
  );
  const footer = story
    ? box(
        { flexDirection: 'column', alignItems: 'center', gap: 36, width: '100%' },
        seal(k.seal, level),
        box({ justifyContent: 'space-between', width: '100%' }, signature(issuedMonth(c.issuedAt), 'DATE OF ISSUE'), signature('radiology.monster', 'ISSUER')),
      )
    : box({ justifyContent: 'space-between', alignItems: 'flex-end', width: '100%' }, signature(issuedMonth(c.issuedAt), 'DATE OF ISSUE'), seal(k.seal, level), signature('radiology.monster', 'ISSUER'));
  // A story is narrow: the ID and the address on two lines.
  const check = box(
    { flexDirection: story ? 'column' : 'row', alignItems: 'center', gap: story ? 4 : 6, marginTop: 10 + k.gap / 2, fontSize: k.base * 0.8, color: '#6b7280' },
    text({}, story ? `Completion record · ID ${c.id}` : `Completion record · ID ${c.id} ·`),
    text({}, `${host(origin)}/verify/${c.id}`),
  );
  // Paper, a double rule in the level's colour, and the content centred inside it.
  const inner = box(
    {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      height: '100%',
      padding: k.inner,
      border: `1px solid ${rgba(st.accent, 0.35)}`,
      borderRadius: 6,
    },
    brandRow,
    middle,
    box({ flexDirection: 'column', alignItems: 'center', width: '100%' }, footer, check),
  );
  const card = box(
    {
      width: '100%',
      height: '100%',
      padding: story ? 22 : 14,
      background: 'linear-gradient(160deg, #ffffff 0%, #f8f7f3 100%)',
      borderRadius: 16,
      fontFamily: 'Inter',
      color: '#111827',
    },
    box({ width: '100%', height: '100%', padding: 5, border: `2px solid ${rgba(st.accent, 0.7)}`, borderRadius: 10 }, inner),
  );
  const frame = box({ width: '100%', height: '100%', padding: k.frame, background: '#0b0b0c' }, card);
  const svg = await satori(frame, { width, height, fonts: loadFonts() });
  await renderer();
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The app's page with tags for this certificate, so a shared link shows its picture and title, and search engines read it as a credential. */
export function certificatePageHtml(indexHtml: string, c: Certificate | null, origin: string, id: string): string {
  const url = `${origin}/verify/${encodeURIComponent(id)}`;
  const revoked = c?.status === 'revoked';
  const credential = c ? credentialName(c.title, c.level) : '';
  const unaided = c ? (levelRule((c.area as CertArea) ?? 'chest', (c.level ?? 1) as CertLevel)?.independent ?? false) : false;
  const title = revoked ? 'Revoked certificate · radiology.monster' : c ? `${c.name} earned the ${credential} · radiology.monster` : 'Certificate · radiology.monster';
  const desc = revoked ? 'This certificate has been revoked and is no longer valid.' : c
    ? `${c.name} earned the ${credential} on radiology.monster: ${c.patients} real patients read, ${Math.round(c.accuracy * 100)}% of ${c.judged} graded answers right${unaided ? ' without hints' : ''}, each marked on the image and checked against the expert outline.`
    : 'Certificates of completion from radiology.monster, radiology reading practice on real patients.';
  const image = c && !revoked ? `${origin}/api/og/certificate?id=${encodeURIComponent(c.id)}` : `${origin}/og.png`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="radiology.monster" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="${c ? 627 : 630}" />`,
    `<meta property="og:image:alt" content="${esc(c ? `Certificate: ${c.name}, ${credential}` : 'radiology.monster')}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  if (c && !revoked) {
    // The credential in schema.org terms, so search engines and profile tools read it as one.
    const rule = levelRule((c.area as CertArea) ?? 'chest', (c.level ?? 1) as CertLevel);
    const data = {
      '@context': 'https://schema.org',
      '@type': 'EducationalOccupationalCredential',
      name: credential,
      credentialCategory: 'certificate',
      educationalLevel: levelName(c.level),
      about: c.title,
      competencyRequired: c.requirements ?? (rule ? levelRequirement((c.area as CertArea) ?? 'chest', rule) : undefined),
      identifier: c.id,
      url,
      image,
      dateCreated: c.issuedAt.slice(0, 10),
      publisher: { '@type': 'Organization', name: 'radiology.monster', url: origin },
    };
    // `<` is escaped so the JSON cannot close the script element.
    tags.push(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  }
  // Replace the site-wide title and sharing tags with this certificate's.
  const stripped = indexHtml
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>\s*/gi, '');
  return stripped.replace(/<\/head>/i, `    ${tags.join('\n    ')}\n  </head>`);
}
