import { describe, expect, it } from 'vitest';
import type { Attempt } from '../src/services/progressRepository';
import { certKey, nextCertificateTask, parseCertKey, stepUrl } from '../src/services/certify';

// A small library: 12 chest patients and 4 head patients, one reading task and one window question each.
type C = { id: string; region: string[] };
const cases = new Map<string, C>();
const tasksByCase = new Map<string, unknown[]>();
const add = (id: string, region: string) => {
  cases.set(id, { id, region: [region] });
  tasksByCase.set(id, [
    { id: `${id}:find`, caseId: id, type: 'locate_finding', modes: ['learn', 'practice', 'assess'], scoring: 'authoritative' },
    { id: `${id}:window`, caseId: id, type: 'choose_window', modes: ['practice'], scoring: 'authoritative' },
  ]);
};
for (let i = 1; i <= 12; i++) add(`c${i}`, 'chest');
for (let i = 1; i <= 4; i++) add(`h${i}`, 'head');
const catalog = { cases, tasksByCase, holdoutGroup: (id: string) => id } as never;
let n = 0;
const answer = (taskId: string, outcome: 'correct' | 'partial' | 'incorrect', independent = false) =>
  ({ id: `a${n++}`, taskId, caseId: taskId.split(':')[0], holdoutGroup: taskId.split(':')[0], submittedAt: `2026-10-29T10:${String(n).padStart(2, '0')}:00Z`, independent, grade: { outcome }, selfReview: null }) as unknown as Attempt;

describe('guided certification', () => {
  it('starts on an unread patient with a reading task, in Assess mode for the unaided level', () => {
    const one = nextCertificateTask(catalog, [], 'chest', 1)!;
    expect(one.taskId).toMatch(/^c\d+:find$/);
    expect(one.mode).toBe('practice');
    expect(one.why).toBe('A patient you have not read yet.');
    expect(nextCertificateTask(catalog, [], 'chest', 3)!.mode).toBe('assess');
    expect(stepUrl(one, 'chest', 1)).toBe(`/read/${one.caseId}?task=${encodeURIComponent(one.taskId)}&mode=practice&cert=chest-1`);
  });

  it('moves to a patient not read yet, never the task just answered', () => {
    const done = [answer('c1:find', 'correct')];
    const next = nextCertificateTask(catalog, done, 'chest', 1, 'c1:find')!;
    expect(next.caseId).not.toBe('c1');
    expect(next.taskId).toMatch(/:find$/);
  });

  it('stops when the level is reached, so the learner can finish it', () => {
    const done = Array.from({ length: 10 }, (_, i) => answer(`c${i + 1}:find`, 'correct'));
    expect(nextCertificateTask(catalog, done, 'chest', 1)).toBeNull();
  });

  it('brings back a mistake when the share right is too low', () => {
    const done = Array.from({ length: 12 }, (_, i) => answer(`c${i + 1}:find`, i < 6 ? 'incorrect' : 'correct'));
    // 12 patients read, 12 graded at 50%: level 1 needs 70%.
    const next = nextCertificateTask(catalog, done, 'chest', 1)!;
    expect(next.why).toBe('A task you got wrong before: try it again.');
    expect(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']).toContain(next.caseId);
  });

  it('asks for more graded answers on tasks not tried yet once the patients are read', () => {
    const done = Array.from({ length: 12 }, (_, i) => answer(`c${i + 1}:find`, 'correct'));
    // Level 2 in a 12-patient area: every patient read, but 30 graded answers needed.
    const next = nextCertificateTask(catalog, done, 'chest', 2)!;
    expect(next.taskId).toMatch(/:window$/);
    expect(next.why).toBe('A task you have not answered yet.');
  });

  it('reads the URL key strictly', () => {
    expect(parseCertKey('chest-2')).toEqual({ area: 'chest', level: 2 });
    expect(parseCertKey('all-3')).toEqual({ area: 'all', level: 3 });
    for (const bad of ['chest-4', 'lungs-1', 'chest', '', null]) expect(parseCertKey(bad)).toBeNull();
    expect(certKey('msk', 1)).toBe('msk-1');
  });
});
