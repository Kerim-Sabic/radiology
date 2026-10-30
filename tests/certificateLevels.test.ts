import { describe, expect, it } from 'vitest';
import { examRequirement, EXAMS, levelRequirement, linkedInFields, LEVELS } from '../src/services/certificates';
import { examDetail, examRule, levelLabel } from '../shared/certificateLevels';

describe('certificate levels', () => {
  it('has three levels, each an exam that gets longer and stricter', () => {
    expect(levelLabel(1)).toBe('Level 1 · Foundation');
    expect(levelLabel(2)).toBe('Level 2 · Intermediate');
    expect(levelLabel(3)).toBe('Level 3 · Advanced');
    expect(EXAMS.area.map(examRequirement)).toEqual([
      '15 questions · untimed · pass mark 70%',
      '25 questions · 3 min each · pass mark 80%',
      '40 questions · 2 min each · pass mark 90% · no half points',
    ]);
    expect(EXAMS.all.map(examRequirement)).toEqual([
      '30 questions from 3+ body areas · untimed · pass mark 70%',
      '50 questions from 4+ body areas · 3 min each · pass mark 80%',
      '75 questions from all 5 body areas · 2 min each · pass mark 90% · no half points',
    ]);
    expect(EXAMS.area.map(examDetail)).toEqual([
      'typical cases',
      'at least 50% mark the finding on the image · no two-answer questions · needs Level 1',
      'at least 60% mark the finding on the image · no two-answer questions · subtle cases first · needs Level 2',
    ]);
    // Every step is harder on every count.
    for (const [a, b] of [[EXAMS.area[0], EXAMS.area[1]], [EXAMS.area[1], EXAMS.area[2]]]) {
      expect(b.questions).toBeGreaterThan(a.questions);
      expect(b.passMark).toBeGreaterThan(a.passMark);
      expect(b.minMarking).toBeGreaterThan(a.minMarking);
      expect(b.retakeHours).toBeGreaterThan(a.retakeHours);
      expect(b.secondsPerQuestion ?? Infinity).toBeLessThan(a.secondsPerQuestion ?? Infinity);
    }
    expect(examRule('breast', 2)).toBe(EXAMS.area[1]);
    expect(examRule('all', 3).minAreas).toBe(5);
    // Certificates issued before the exams still show what they recorded.
    expect(levelRequirement('chest', LEVELS.area[2])).toBe('40 patients · 30 graded answers without hints · 85% right');
  });

  it('names the level in the LinkedIn certification', () => {
    const f = linkedInFields({ id: 'abcDEF123_-x', name: 'Ada', area: 'chest', level: 2, title: 'Chest Imaging', patients: 15, judged: 15, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' }, 'https://www.radiology.monster');
    expect(f.name).toBe('Chest Imaging Certificate – Level 2 (Intermediate)');
    expect(f.skills).toEqual(['Radiology', 'Chest Radiography', 'Computed Tomography (CT)', 'Medical Imaging']);
    expect(f.credentialUrl).toBe('https://www.radiology.monster/verify/abcDEF123_-x');
    expect(linkedInFields({ id: 'x', name: 'Ada', area: 'breast', title: 'Breast Imaging', patients: 12, judged: 12, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' }, 'https://x').name).toBe('Breast Imaging Certificate – Level 1 (Foundation)');
  });
});
