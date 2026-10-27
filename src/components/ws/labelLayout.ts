/**
 * Collision-free label placement for anatomy names on a viewport (canvas px).
 * Each label is anchored at a point INSIDE its structure; if the pill would overlap another
 * label or leave the viewport, nearby positions are tried with a leader line; otherwise the
 * label is skipped (the name stays available on hover). Larger structures are placed first.
 */
import { pointInPolygon, polygonArea, polygonBounds, type Vec2 } from '../../lib/geometry';

export interface LabelItem {
  id: string;
  text: string;
  color: string;
  polys: Vec2[][];
  priority?: number; // higher = placed first (selected / hovered)
}

export interface PlacedLabel {
  id: string;
  text: string;
  color: string;
  anchor: Vec2;
  box: [number, number, number, number]; // x, y, w, h
  leader: boolean;
}

const CHAR_W = 6.5;
const PAD_X = 8;
const H = 19;

export function labelWidth(text: string) {
  return Math.round(text.length * CHAR_W + PAD_X * 2);
}

/** A point guaranteed inside the polygon: centroid if inside, else the middle of the widest horizontal chord. */
export function interiorPoint(poly: Vec2[]): Vec2 {
  const c: Vec2 = [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
  if (pointInPolygon(c, poly)) return c;
  const [x0, y0, x1, y1] = polygonBounds(poly);
  let best: Vec2 = c;
  let bestW = -1;
  for (let k = 1; k <= 7; k++) {
    const y = y0 + ((y1 - y0) * k) / 8;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j];
      const [bx, by] = poly[i];
      if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > bestW) {
        bestW = w;
        best = [(xs[i] + xs[i + 1]) / 2, y];
      }
    }
  }
  return bestW > 0 ? best : [(x0 + x1) / 2, (y0 + y1) / 2];
}

const overlaps = (a: number[], b: number[], m = 3) => a[0] < b[0] + b[2] + m && b[0] < a[0] + a[2] + m && a[1] < b[1] + b[3] + m && b[1] < a[1] + a[3] + m;

export function layoutLabels(items: LabelItem[], width: number, height: number, opts: { preferOutside?: boolean } = {}): { placed: PlacedLabel[]; hidden: number } {
  const ranked = items
    .map((it) => {
      const largest = [...it.polys].sort((a, b) => polygonArea(b) - polygonArea(a))[0];
      return { it, largest, area: largest ? polygonArea(largest) : 0 };
    })
    .filter((x) => x.largest && x.largest.length >= 3)
    .sort((a, b) => (b.it.priority ?? 0) - (a.it.priority ?? 0) || b.area - a.area);
  const placed: PlacedLabel[] = [];
  let hidden = 0;
  const dirs: Vec2[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ];
  for (const { it, largest } of ranked) {
    const anchor = interiorPoint(largest);
    const w = labelWidth(it.text);
    const candidates: Array<{ box: [number, number, number, number]; leader: boolean }> = [];
    if (!opts.preferOutside) candidates.push({ box: [anchor[0] - w / 2, anchor[1] - H / 2, w, H], leader: false });
    for (const r of [26, 42, 62, 86]) {
      for (const d of dirs) {
        const cx = anchor[0] + d[0] * (r + (d[0] !== 0 ? w / 2 : 0));
        const cy = anchor[1] + d[1] * (r + (d[1] !== 0 ? H / 2 : 0));
        candidates.push({ box: [cx - w / 2, cy - H / 2, w, H], leader: true });
      }
    }
    const ok = candidates.find((c) => c.box[0] >= 2 && c.box[1] >= 2 && c.box[0] + c.box[2] <= width - 24 && c.box[1] + c.box[3] <= height - 2 && !placed.some((p) => overlaps(p.box, c.box)));
    if (!ok) {
      hidden++;
      continue;
    }
    placed.push({ id: it.id, text: it.text, color: it.color, anchor, box: ok.box, leader: ok.leader });
  }
  return { placed, hidden };
}

/** Point on the box edge closest to the anchor (for the leader line). */
export function leaderEnd(anchor: Vec2, box: [number, number, number, number]): Vec2 {
  const [x, y, w, h] = box;
  return [Math.max(x, Math.min(anchor[0], x + w)), Math.max(y, Math.min(anchor[1], y + h))];
}
