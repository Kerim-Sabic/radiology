import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Film { id: string; pack: string; thumb: string; aspect: number; ctr: number; heart: number[][]; lungLeft: number[][]; lungRight: number[][]; x: number[] }
const data = JSON.parse(readFileSync('public/content/cxr-ratio.json', 'utf8')) as { films: Film[] };

describe('reference heart–chest ratios (scripts/data/cxr_ratio.py)', () => {
  it('has many films, each with a picture on disk and unique ids', () => {
    expect(data.films.length).toBeGreaterThan(100);
    expect(new Set(data.films.map((f) => f.id)).size).toBe(data.films.length);
    for (const f of data.films) expect(existsSync(`public${f.thumb}`)).toBe(true);
  });
  it('each reference ratio is plausible and equals heart width over chest width from its own edges', () => {
    for (const f of data.films) {
      const [h0, h1, t0, t1] = f.x;
      expect(f.ctr).toBeGreaterThanOrEqual(0.3);
      expect(f.ctr).toBeLessThanOrEqual(0.8);
      expect(h1).toBeGreaterThan(h0);
      expect(t1).toBeGreaterThan(t0);
      expect(Math.abs((h1 - h0) / (t1 - t0) - f.ctr)).toBeLessThan(0.006);
      // The heart sits inside the chest (a small margin for the outline).
      expect(h0).toBeGreaterThanOrEqual(t0 - 0.03);
      expect(h1).toBeLessThanOrEqual(t1 + 0.03);
    }
  });
  it('outlines are real shapes in 0..1 picture coordinates', () => {
    for (const f of data.films) {
      for (const ring of [f.heart, f.lungLeft, f.lungRight]) {
        expect(ring.length).toBeGreaterThanOrEqual(8);
        for (const [x, y] of ring) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
      }
    }
  });
  it('the films are not all one side of normal (a drill needs both)', () => {
    const above = data.films.filter((f) => f.ctr > 0.5).length;
    expect(above).toBeGreaterThan(10);
    expect(data.films.length - above).toBeGreaterThan(10);
  });
});
