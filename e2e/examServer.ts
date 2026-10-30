/**
 * A stand-in for the server's side of the certification exams (`vite preview` serves no /api): it picks questions
 * from the built library with the same rules the server uses (shared/examQuestions.ts), keeps each question's clock
 * and answer, and scores the exam. It does not grade: answered questions count as `answered` says.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { examEligibleTask, examPoints, isMarking, isTwoOption, pickExam, questionAreaOf, type ExamCandidate, type QuestionOutcome } from '../shared/examQuestions';
import type { CertArea, CertLevel } from '../shared/certificateLevels';

let pool: ExamCandidate[] | null = null;
function candidates(): ExamCandidate[] {
  if (pool) return pool;
  const root = resolve(process.cwd(), 'dist/packs');
  const index = JSON.parse(readFileSync(resolve(root, 'index.json'), 'utf8')) as { packs: Array<{ manifest: string; lessons: string | null }> };
  const targets = new Map<string, { classId: string; provenance: string }>();
  const groups = new Map<string, string>();
  const lessons: Array<{ cases: Array<{ id: string; subjectKey: string; region: string[]; difficulty: string }>; tasks: never[] }> = [];
  for (const e of index.packs) {
    const m = JSON.parse(readFileSync(resolve(root, e.manifest), 'utf8'));
    for (const t of m.referenceTargets) targets.set(t.id, t);
    for (const s of m.subjects) groups.set(s.key, s.holdoutGroup);
    const file = resolve(root, e.lessons ?? e.manifest.replace(/pack\.json$/, 'lessons.json'));
    if (existsSync(file)) lessons.push(JSON.parse(readFileSync(file, 'utf8')));
  }
  const cases = new Map(lessons.flatMap((l) => l.cases.map((c) => [c.id, c] as const)));
  pool = [];
  for (const l of lessons)
    for (const task of l.tasks as Array<Parameters<typeof examEligibleTask>[0]>) {
      const c = cases.get(task.caseId);
      if (!c || !examEligibleTask(task, (id) => targets.get(id)?.provenance)) continue;
      const area = questionAreaOf(
        c.region,
        task.targets.map((t) => targets.get(t.targetId)?.classId ?? ''),
      );
      if (area) pool.push({ taskId: task.id, caseId: c.id, area, group: groups.get(c.subjectKey) ?? c.id, subtle: c.difficulty === 'subtle', marking: isMarking(task), twoOption: isTwoOption(task) });
    }
  return pool;
}

interface MockExam {
  id: string;
  area: CertArea;
  level: CertLevel;
  startedAt: string;
  items: Array<{ caseId: string; taskId: string; area: CertArea; startedAt: string | null; submittedAt: string | null; outcome: QuestionOutcome }>;
}

/** Routes the exam endpoints to an in-test server. `answered` is how an answered question is scored. */
export async function mockExamServer(page: Page, o: { answered?: Exclude<QuestionOutcome, null> } = {}) {
  const exams = new Map<string, MockExam>();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/certificates/exam/*', async (r) => {
    const path = new URL(r.request().url()).pathname.split('/').pop()!;
    const body = r.request().postDataJSON() as Record<string, unknown>;
    calls.push({ path, body });
    const exam = typeof body.examId === 'string' ? exams.get(body.examId) : undefined;
    if (path === 'start') {
      const area = body.area as CertArea;
      const level = body.level as CertLevel;
      const id = `exam-${Math.random().toString(16).slice(2).padEnd(24, '0').slice(0, 24)}`;
      const picked = pickExam(candidates(), area, level, new Set(), Math.random);
      const e: MockExam = { id, area, level, startedAt: new Date().toISOString(), items: picked.map((c) => ({ caseId: c.caseId, taskId: c.taskId, area: c.area, startedAt: null, submittedAt: null, outcome: null })) };
      exams.set(id, e);
      return r.fulfill({ json: { exam: { ...e, finishedAt: null, items: e.items.map(({ outcome: _, ...it }) => ({ ...it, attemptId: null })) } } });
    }
    if (!exam) return r.fulfill({ status: 400, json: { error: 'That exam was not found.' } });
    const item = exam.items[body.index as number];
    if (path === 'open') {
      item.startedAt ??= new Date().toISOString();
      return r.fulfill({ json: { openedAt: item.startedAt } });
    }
    if (path === 'answer') {
      item.submittedAt = new Date().toISOString();
      item.outcome = body.timedOut ? 'timeout' : (o.answered ?? 'correct');
      return r.fulfill({ json: { saved: true } });
    }
    const outcomes = exam.items.map((it) => it.outcome);
    const p = examPoints(outcomes, exam.area, exam.level);
    return r.fulfill({
      json: {
        result: { ...p, questions: outcomes.length, patients: new Set(exam.items.map((it) => it.caseId)).size, areas: new Set(exam.items.map((it) => it.area)).size, outcomes, finishedAt: new Date().toISOString() },
      },
    });
  });
  return { calls, exams };
}
