import { describe, expect, it } from 'vitest';
import { areaProgress, weakestArea } from '../src/services/areas';
import type { Attempt } from '../src/services/progressRepository';
import type { Task } from '../src/schema/content';

const task = (id: string, caseId: string, type: string, modes = ['learn', 'practice', 'assess']) => ({ id, caseId, type, modes, title: id }) as unknown as Task;
function catalog() {
  const cases = new Map(
    [
      ['A', 'A', ['chest']],
      ['B', 'B', ['chest']],
      ['C', 'C', ['abdomen']],
      ['D', 'D', ['pelvis']],
      ['K', 'K', ['extremity']],
    ].map(([id, group, region]) => [id as string, { id, group, region } as never]),
  );
  const tasksByCase = new Map<string, Task[]>([
    ['A', [task('A:anat', 'A', 'find_structure'), task('A:read', 'A', 'locate_finding')]],
    ['B', [task('B:win', 'B', 'choose_window'), task('B:learn', 'B', 'locate_finding', ['learn'])]],
    ['C', [task('C:read', 'C', 'locate_finding')]],
    ['D', [task('D:read', 'D', 'locate_finding')]],
    ['K', [task('K:read', 'K', 'locate_finding')]],
  ]);
  return { cases, tasksByCase, holdoutGroup: (id: string) => (cases.get(id) as unknown as { group: string }).group } as never;
}
const done = (caseId: string, taskId: string, outcome: 'correct' | 'partial' | 'incorrect' | null) =>
  ({ caseId, taskId, holdoutGroup: caseId, submittedAt: '2026-10-28T10:00:00Z', grade: outcome ? { outcome } : null, selfReview: null }) as unknown as Attempt;

describe('progress by area', () => {
  it('counts patients read and accuracy, and suggests a reading task on a patient not read yet', () => {
    const areas = areaProgress(catalog(), [done('A', 'A:read', 'correct'), done('A', 'A:anat', 'partial')]);
    const chest = areas.find((a) => a.id === 'chest')!;
    expect(chest).toMatchObject({ patients: 2, read: 1, judged: 2, correct: 1, accuracy: 0.75 });
    expect(chest.next).toEqual({ caseId: 'B', taskId: 'B:win' }); // B is unread; its learn-only task is skipped
    expect(areas.find((a) => a.id === 'abdomen')!.next).toEqual({ caseId: 'C', taskId: 'C:read' });
    expect(areas.find((a) => a.id === 'breast')).toMatchObject({ patients: 0, next: null });
  });

  it('points to the weakest area tried, or else the least read', () => {
    const misses = [done('C', 'C:read', 'incorrect'), done('C', 'C:read', 'incorrect'), done('C', 'C:read', 'partial')];
    const weak = weakestArea(areaProgress(catalog(), misses))!;
    expect(weak.id).toBe('abdomen');
    expect(weak.next).toEqual({ caseId: 'D', taskId: 'D:read' }); // practise it on another patient
    expect(weakestArea(areaProgress(catalog(), [done('A', 'A:read', 'correct')]))!.id).toBe('abdomen'); // first unread area in order
  });
});
