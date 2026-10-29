import { describe, expect, it } from 'vitest';
import type { AreaProgress } from '../src/services/areas';
import type { Attempt } from '../src/services/progressRepository';
import { certificateStatus, levelRequirement, linkedInFields, LEVELS } from '../src/services/certificates';
import { levelLabel, levelRule } from '../shared/certificateLevels';

const area = (id: string, o: Partial<AreaProgress>): AreaProgress => ({
  id,
  label: id,
  patients: 100,
  read: 0,
  judged: 0,
  correct: 0,
  accuracy: null,
  independentJudged: 0,
  independentAccuracy: null,
  next: null,
  ...o,
});
const find = (list: ReturnType<typeof certificateStatus>, a: string, level: number) => list.find((s) => s.area === a && s.level === level)!;

describe('certificate levels', () => {
  it('gives every area three levels, then three for the whole library', () => {
    const list = certificateStatus([area('chest', {}), area('head', {})], []);
    expect(list.map((s) => `${s.area}:${s.level}`)).toEqual(['chest:1', 'chest:2', 'chest:3', 'head:1', 'head:2', 'head:3', 'all:1', 'all:2', 'all:3']);
    expect(find(list, 'all', 1).title).toBe('General Radiology');
    expect(levelLabel(1)).toBe('Level 1 · Foundation');
    expect(levelLabel(2)).toBe('Level 2 · Intermediate');
    expect(levelLabel(3)).toBe('Level 3 · Advanced');
    expect(levelRequirement('chest', LEVELS.area[2])).toBe('40 patients · 30 graded answers without hints · 85% right');
  });

  it('opens each level at its own bar', () => {
    const chest = area('chest', { read: 26, judged: 32, accuracy: 0.82, independentJudged: 12, independentAccuracy: 0.9 });
    const list = certificateStatus([chest], []);
    expect(find(list, 'chest', 1).eligible).toBe(true);
    expect(find(list, 'chest', 2).eligible).toBe(true);
    const three = find(list, 'chest', 3);
    expect(three.eligible).toBe(false);
    expect(three.todo).toBe('Read 14 more patients.');
    // The advanced level counts only answers without hints.
    const more = certificateStatus([{ ...chest, read: 40 }], []);
    expect(find(more, 'chest', 3).judged).toBe(12);
    expect(find(more, 'chest', 3).todo).toBe('Answer 18 more graded tasks without hints.');
    const low = certificateStatus([{ ...chest, read: 40, independentJudged: 30, independentAccuracy: 0.8 }], []);
    expect(find(low, 'chest', 3).todo).toBe('Get to 85% right without hints (now 80%): retry your mistakes.');
  });

  it('asks a smaller area for every patient it has, never fewer than ten', () => {
    const list = certificateStatus([area('abdomen', { patients: 17, read: 12, judged: 40, accuracy: 0.9 })], []);
    expect(find(list, 'abdomen', 1).needPatients).toBe(10);
    expect(find(list, 'abdomen', 2).needPatients).toBe(17);
    expect(find(list, 'abdomen', 2).todo).toBe('Read every patient in this area: 5 more patients to go.');
    const tiny = certificateStatus([area('breast', { patients: 6, read: 6, judged: 12, accuracy: 1 })], []);
    expect(find(tiny, 'breast', 1).eligible).toBe(false);
    expect(find(tiny, 'breast', 1).todo).toMatch(/on the way/);
  });

  it('asks the whole library for breadth across areas', () => {
    const attempts = Array.from({ length: 45 }, (_, i) => ({ submittedAt: 'x', holdoutGroup: `p${i}`, independent: false, grade: { outcome: 'correct' }, selfReview: null }) as unknown as Attempt);
    const two = certificateStatus([area('chest', { read: 30 }), area('head', { read: 15 })], attempts);
    expect(find(two, 'all', 1).todo).toBe('Read at least 3 patients in 3 body areas (2 so far).');
    const three = certificateStatus([area('chest', { read: 30 }), area('head', { read: 12 }), area('msk', { read: 3 })], attempts);
    expect(find(three, 'all', 1).eligible).toBe(true);
    expect(find(three, 'all', 2).eligible).toBe(false);
    expect(levelRule('all', 3).minAreas).toBe(5);
  });

  it('names the level in the LinkedIn certification', () => {
    const f = linkedInFields({ id: 'abcDEF123_-x', name: 'Ada', area: 'chest', level: 2, title: 'Chest Imaging', patients: 25, judged: 30, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' }, 'https://www.radiology.monster');
    expect(f.name).toBe('Chest Imaging Certificate – Level 2 (Intermediate)');
    expect(f.skills).toEqual(['Radiology', 'Chest Radiography', 'Computed Tomography (CT)', 'Medical Imaging']);
    expect(f.credentialUrl).toBe('https://www.radiology.monster/certificate/abcDEF123_-x');
    expect(linkedInFields({ id: 'x', name: 'Ada', area: 'breast', title: 'Breast Imaging', patients: 12, judged: 12, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' }, 'https://x').name).toBe('Breast Imaging Certificate – Level 1 (Foundation)');
  });
});
