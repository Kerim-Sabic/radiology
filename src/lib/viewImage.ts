/**
 * One viewport as a PNG for study notes: the image, every drawing on it (outlines and their names, marks,
 * measurements, reference lines), the orientation letters and a footer naming the series, the slice and the
 * image source with its licence.
 */

/** File name from free text: lower case, words joined by dashes. */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'view'
  );
}

/** "Creative Commons Attribution 4.0 International License" → "CC BY 4.0"; other licences up to their first ";". */
export function shortLicense(l: string): string {
  const abbr = /\b(CC0(?: 1\.0)?|CC BY(?:-[A-Z]{2})*(?: \d\.\d)?)\b/.exec(l);
  if (abbr) return abbr[1];
  const cc = /^Creative Commons Attribution((?:-(?:NonCommercial|ShareAlike|NoDerivatives))*) (\d\.\d)/i.exec(l);
  if (cc) {
    const parts = cc[1].split('-').filter(Boolean).map((x) => ({ noncommercial: 'NC', sharealike: 'SA', noderivatives: 'ND' })[x.toLowerCase()] ?? x);
    return `${['CC BY', ...parts].join('-')} ${cc[2]}`;
  }
  return l.split(';')[0];
}

/** Shorten text to fit a width, ending with an ellipsis. */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function svgImage(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('font-family', 'Inter, system-ui, sans-serif');
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** `footer`: up to two lines under the image (what it is; where it comes from). */
export async function viewToPng(panel: HTMLElement, footer: string[]): Promise<Blob | null> {
  const el = panel.querySelector<HTMLElement>('.vp-el');
  const canvas = el?.querySelector('canvas');
  if (!el || !canvas) return null;
  const w = el.clientWidth;
  const h = el.clientHeight;
  const lines = footer.filter(Boolean).slice(0, 2);
  const foot = 10 + lines.length * 16;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const out = document.createElement('canvas');
  out.width = Math.round(w * dpr);
  out.height = Math.round((h + foot) * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h + foot);
  ctx.drawImage(canvas, 0, 0, w, h);
  // The viewer's own drawings (measurements, marks) and the app's layers (outlines, names, reference lines), in page order.
  for (const svg of panel.querySelectorAll<SVGSVGElement>('.vp-el svg, svg.vp-svg')) {
    const r = svg.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const img = await svgImage(svg, r.width, r.height);
    if (img) ctx.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height);
  }
  // Orientation letters where the viewer shows them.
  ctx.font = '600 13px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const box = el.getBoundingClientRect();
  for (const e of panel.querySelectorAll<HTMLElement>('.vp-edge')) {
    const r = e.getBoundingClientRect();
    if (!e.textContent || r.width > 60) continue; // skip the long notes ("orientation not recorded")
    ctx.fillStyle = '#000';
    ctx.fillText(e.textContent, r.left - box.left + r.width / 2 + 1, r.top - box.top + r.height / 2 + 1);
    ctx.fillStyle = '#facc15';
    ctx.fillText(e.textContent, r.left - box.left + r.width / 2, r.top - box.top + r.height / 2);
  }
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, h, w, foot);
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    ctx.fillStyle = i ? '#94a3b8' : '#e2e8f0';
    ctx.fillText(fitText(line, w - 16, (s) => ctx.measureText(s).width), 8, h + 13 + i * 16);
  });
  return new Promise((res) => {
    try {
      out.toBlob(res, 'image/png');
    } catch {
      res(null); // a drawing the browser will not export
    }
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
