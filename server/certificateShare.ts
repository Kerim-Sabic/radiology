import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement as h, type ReactNode } from 'react';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { Certificate } from './certificates.js';
import { levelLabel, levelRule, type CertArea } from '../shared/certificateLevels.js';

/**
 * What a shared certificate looks like outside the app: the picture LinkedIn, X, WhatsApp or Slack show for its
 * link (1200×627, or 1080×1080 for posting as an image), and the page tags that point them to it.
 */

type FontEntry = { name: string; data: Buffer; weight: 400 | 600 | 800; style: 'normal' };
let fonts: FontEntry[] | null = null;
function loadFonts(): FontEntry[] {
  const f = (file: string) => readFileSync(new URL(`./fonts/${file}`, import.meta.url));
  fonts ??= [
    { name: 'Inter', data: f('Inter-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Inter', data: f('Inter-SemiBold.ttf'), weight: 600, style: 'normal' },
    { name: 'Jakarta', data: f('PlusJakartaSans-ExtraBold.ttf'), weight: 800, style: 'normal' },
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

/** A round seal: ring, check mark and the level. */
function seal(size: number, level: number) {
  const ring = h(
    'svg',
    { width: size, height: size, viewBox: '0 0 200 200' },
    h('defs', null, h('linearGradient', { id: 'g', x1: '0', y1: '0', x2: '1', y2: '1' }, h('stop', { offset: '0', stopColor: '#1d4ed8' }), h('stop', { offset: '1', stopColor: '#1e40af' }))),
    h('circle', { cx: 100, cy: 100, r: 92, fill: 'none', stroke: 'url(#g)', strokeWidth: 10 }),
    h('circle', { cx: 100, cy: 100, r: 74, fill: '#eff4ff', stroke: '#c9d7fb', strokeWidth: 2, strokeDasharray: '4 6' }),
    h('path', { d: 'M68 102 L91 125 L134 80', fill: 'none', stroke: '#1d4ed8', strokeWidth: 14, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  );
  return box({ flexDirection: 'column', alignItems: 'center', gap: 10 }, ring, text({ fontSize: 16, fontWeight: 600, letterSpacing: 4, color: '#1d4ed8' }, `LEVEL ${level}`));
}

export async function certificateImage(c: Certificate, origin: string, square = false): Promise<Response> {
  // Only image requests need the font engine and its WebAssembly initialization.
  const { default: satori } = await import('satori');
  const width = square ? 1080 : 1200;
  const height = square ? 1080 : 627;
  const pad = square ? 56 : 40;
  const logo = loadBrand();
  const unaided = levelRule((c.area as CertArea) ?? 'chest', c.level ?? 1)?.independent ?? false;
  const long = c.name.length > 24;
  const nameSize = square ? (long ? 58 : 74) : long ? 50 : 64;
  const stat = (value: string, label: string) =>
    box({ flexDirection: 'column', gap: 2 }, text({ fontFamily: 'Jakarta', fontSize: square ? 40 : 32, color: '#111827' }, value), text({ fontSize: 15, color: '#6b7280', fontWeight: 600, letterSpacing: 1.5 }, label));
  const words = box(
    { flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0 },
    text({ fontSize: 17, fontWeight: 600, letterSpacing: 4, color: '#6b7280' }, 'CERTIFICATE OF COMPLETION'),
    text({ marginTop: 10, fontFamily: 'Jakarta', fontSize: nameSize, lineHeight: 1.05, letterSpacing: -1.5 }, c.name),
    text({ marginTop: 14, fontSize: 22, color: '#4b5563' }, `has completed ${levelLabel(c.level)} in`),
    text({ marginTop: 4, fontFamily: 'Jakarta', fontSize: square ? 52 : 42, color: '#1d4ed8', letterSpacing: -0.5, lineHeight: 1.1 }, c.title),
    text({ marginTop: 14, fontSize: 19, color: '#4b5563', lineHeight: 1.45, maxWidth: square ? 900 : 640 }, 'Real patients, each read in a full workstation, marked on the image and graded against the expert outline.'),
  );
  const card = box(
    {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      background: 'linear-gradient(160deg, #ffffff 0%, #f5f6fb 100%)',
      borderRadius: 28,
      padding: square ? '60px 64px 44px' : '40px 52px 26px',
      fontFamily: 'Inter',
      color: '#111827',
    },
    box(
      { justifyContent: 'space-between', alignItems: 'center', width: '100%' },
      box(
        { alignItems: 'center', gap: 14 },
        h('img', { src: logo.icon, width: square ? 64 : 54, height: square ? 64 : 54, style: { borderRadius: square ? 16 : 13 } }),
        box({ fontFamily: 'Jakarta', fontSize: square ? 32 : 28 }, text({ color: '#111827' }, 'radiology'), text({ color: '#1d4ed8' }, '.monster')),
      ),
      box(
        { alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999, background: '#ecfdf5', border: '1px solid #a7f3d0' },
        box({ width: 10, height: 10, borderRadius: 999, background: '#10b981' }),
        text({ fontSize: 17, fontWeight: 600, color: '#047857' }, 'Verified certificate'),
      ),
    ),
    square
      ? box({ flexDirection: 'column', marginTop: 56, gap: 40 }, words, box({ justifyContent: 'center' }, seal(170, c.level ?? 1)))
      : box({ marginTop: 30, alignItems: 'center', gap: 32, width: '100%' }, words, seal(190, c.level ?? 1)),
    box(
      { marginTop: 'auto', gap: square ? 56 : 52, alignItems: 'flex-end', width: '100%', borderTop: '2px solid #e5e7eb', paddingTop: 18 },
      stat(String(c.patients), 'REAL PATIENTS'),
      stat(`${Math.round(c.accuracy * 100)}%`, unaided ? 'RIGHT WITHOUT HINTS' : 'GRADED ANSWERS RIGHT'),
      stat(issuedMonth(c.issuedAt), 'ISSUED'),
    ),
    text({ marginTop: 12, fontSize: 15, color: '#6b7280' }, `Check this certificate: ${host(origin)}/certificate/${c.id}`),
  );
  const frame = box(
    {
      width: '100%',
      height: '100%',
      padding: pad,
      background: '#0b0b0c',
    },
    card,
  );
  const svg = await satori(frame, { width, height, fonts: loadFonts() });
  await renderer();
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600, s-maxage=3600', 'X-Content-Type-Options': 'nosniff' },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The app's page with tags for this certificate, so a shared link shows its picture and title. */
export function certificatePageHtml(indexHtml: string, c: Certificate | null, origin: string, id: string): string {
  const url = `${origin}/certificate/${encodeURIComponent(id)}`;
  const title = c ? `${c.name} completed ${c.title}, ${levelLabel(c.level)} · radiology.monster` : 'Certificate · radiology.monster';
  const desc = c
    ? `${c.name} read ${c.patients} real patients on radiology.monster, with ${Math.round(c.accuracy * 100)}% of ${c.judged} graded answers right, each marked on the image and checked against the expert outline.`
    : 'Certificates of completion from radiology.monster, radiology reading practice on real patients.';
  const image = c ? `${origin}/api/og/certificate?id=${encodeURIComponent(c.id)}` : `${origin}/og.png`;
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
    `<meta property="og:image:width" content="${c ? 1200 : 1200}" />`,
    `<meta property="og:image:height" content="${c ? 627 : 630}" />`,
    `<meta property="og:image:alt" content="${esc(c ? `Certificate: ${c.name}, ${c.title}, ${levelLabel(c.level)}` : 'radiology.monster')}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ].join('\n    ');
  // Replace the site-wide title and sharing tags with this certificate's.
  const stripped = indexHtml
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>\s*/gi, '');
  return stripped.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}
