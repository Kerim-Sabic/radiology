import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PackManifest, LessonFile } from '../src/schema/content';
import { filterCommercial } from '../scripts/build/commercialContent';

describe('paid-build content', () => {
  it('removes restricted scans, thumbnails, targets and lessons without mutating source packs', () => {
    const pack = PackManifest.parse(JSON.parse(readFileSync('public/packs/more-ct-xr/pack.json', 'utf8')));
    const lessons = LessonFile.parse(JSON.parse(readFileSync('public/packs/more-ct-xr/lessons.json', 'utf8')));
    const excluded = new Set(pack.subjects.filter(s => s.sourceId === 'tcia:MIDRC-RICORD-1C').map(s => s.key));
    expect(excluded.size).toBe(6);
    const result = filterCommercial(pack, lessons, excluded);
    expect(result.pack.subjects.some(s => excluded.has(s.key))).toBe(false);
    expect(result.pack.series.some(s => excluded.has(s.subjectKey))).toBe(false);
    expect(result.lessons?.cases.some(c => excluded.has(c.subjectKey))).toBe(false);
    expect(result.files.filter(f => f.endsWith('.dcm'))).toHaveLength(6);
    expect(result.files.filter(f => f.endsWith('.png'))).toHaveLength(6);
    expect(pack.subjects.filter(s => excluded.has(s.key))).toHaveLength(6);
    expect(result.pack.sources.some(s => /NonCommercial/i.test(s.license))).toBe(false);
  });
});
