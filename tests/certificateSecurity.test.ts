import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Task } from '../src/schema/content';
import type { AnswerKeys, ServerExam } from '../server/certificateExam';

const fake = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  sets: new Map<string, Set<string>>(),
}));
vi.mock('../server/store', () => ({
  rateLimit: async () => true,
  db: () => ({
    get: async (k: string) => structuredClone(fake.kv.get(k)) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && fake.kv.has(k)) return null;
      fake.kv.set(k, structuredClone(v));
      return 'OK';
    },
    del: async (k: string) => fake.kv.delete(k),
    smembers: async (k: string) => [...(fake.sets.get(k) ?? [])],
    sadd: async (k: string, v: string) => fake.sets.set(k, new Set([...(fake.sets.get(k) ?? []), v])),
    srem: async (k: string, v: string) => fake.sets.get(k)?.delete(v),
    eval: async (_lua: string, ks: string[], args: string[]) => {
      const old = fake.kv.get(ks[0]);
      if (old) return old;
      if (fake.kv.has(ks[1])) return '';
      fake.kv.set(ks[1], JSON.parse(args[1]));
      fake.kv.set(ks[0], args[0]);
      fake.sets.set(ks[2], new Set([...(fake.sets.get(ks[2]) ?? []), args[0]]));
      return args[0];
    },
  }),
}));
import { answerQuestion, examKey, finishExam, openQuestion, startExam } from '../server/certificateExam';
import { claimCertificate, myCertificates, publicCertificate, revokeCertificate } from '../server/certificates';
import { certificateMail, queueCertificateEmail, sendCertificateEmails } from '../server/certificateEmail';
import { linkedinCredentialUrl } from '../shared/credential';

const user = { userId: 'test-user', email: 'learner@example.test', name: 'Ada', tokenHash: 'test' };
const other = { ...user, userId: 'someone-else' };

// 60 chest patients, each with a three-answer question (the right answer is "a") and a question marked on the image.
const keys: AnswerKeys = { version: 'test', targets: {}, series: {}, tasks: {} };
const base = {
  type: 'describe_finding',
  title: 'Study task',
  prompt: 'Answer',
  modes: ['learn', 'practice', 'assess'],
  seriesUids: ['series'],
  start: { seriesUid: 'series', slice: 'first', windowPreset: null },
  scoring: 'authoritative',
  hints: [],
  explanation: 'Reference',
  bookAnchors: [],
  objectiveIds: [],
  skillDimensions: [],
};
for (let i = 0; i < 60; i++) {
  const choice = Task.parse({
    ...base,
    id: `choice-${i}`,
    caseId: `case-${i}`,
    targets: [],
    grading: {
      kind: 'choice',
      multiple: false,
      options: ['a', 'b', 'c'].map((id) => ({ id, text: id, correct: id === 'a', why: '' })),
    },
  });
  const mark = Task.parse({
    ...base,
    id: `mark-${i}`,
    caseId: `case-${i}`,
    type: 'locate_finding',
    targets: [{ targetId: `t-${i}`, name: 'Finding' }],
    grading: { kind: 'findings', matchRule: 'center_in_target', iouThreshold: null, slabToleranceMm: 1, inPlaneToleranceMm: 3, allowNoFinding: true },
  });
  keys.targets[`t-${i}`] = { ref: { id: `t-${i}`, classId: 'finding:nodule', provenance: 'source_manual', seriesUid: 'series' } } as never;
  for (const task of [choice, mark])
    keys.tasks[task.id] = { task, caseId: task.caseId, patient: `patient-${i}`, areas: ['chest'], region: ['chest'], difficulty: i % 3 ? 'typical' : 'subtle', packId: 'test', lessonVersion: '1', revision: 'r1' };
}
const answer = (taskId: string, changes = {}) => ({
  taskId,
  lessonVersion: '1',
  mode: 'assess',
  marks: [],
  position: null,
  choice: ['a'],
  declaredNoFinding: false,
  hintsUsed: [],
  revealed: false,
  ...changes,
});
const t0 = new Date('2026-10-30T10:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const held = (...levels: number[]) => levels.map((level) => ({ area: 'chest', level }));
type AppExam = { id: string; items: Array<{ taskId: string }> };

/** Starts an exam and answers every question: `right` of the three-answer questions correctly, the rest wrongly. */
async function takeExam(level: 1 | 2 | 3, right: number, has = held(...[1, 2].filter((l) => l < level))) {
  const s = await startExam(user.userId, has, { area: 'chest', level }, keys, t0, () => 0.42);
  if (!s.ok) throw new Error(s.error);
  const exam = s.exam as AppExam;
  let n = 0;
  for (const [i, it] of exam.items.entries()) {
    await openQuestion(user.userId, { examId: exam.id, index: i }, at(i * 10));
    const ok = it.taskId.startsWith('choice') && n++ < right;
    await answerQuestion(user.userId, { examId: exam.id, index: i, answer: answer(it.taskId, { choice: [ok ? 'a' : 'b'] }) }, keys, at(i * 10 + 5));
  }
  const f = await finishExam(user.userId, { examId: exam.id }, at(1000));
  if (!f.ok) throw new Error(f.error);
  return { exam, result: f.result };
}
const claim = (examId: string, changes = {}) => ({ area: 'chest', level: 1, name: 'Ada Lovelace', examId, ...changes });

beforeEach(() => {
  fake.kv.clear();
  fake.sets.clear();
  vi.stubEnv('APP_URL', 'https://www.radiology.monster');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('certification exams on the server', () => {
  it('picks the questions itself, by the level rules, and never sends the answer keys', async () => {
    const s = await startExam(user.userId, [], { area: 'chest', level: 1 }, keys, t0);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.exam.items).toHaveLength(15);
    expect(new Set(s.exam.items.map((it) => it.caseId)).size).toBe(15);
    expect(JSON.stringify(s.exam)).not.toMatch(/"correct"|grading|options/);
    // Level 2: 25 questions, at least half marked on the image; it needs the Level 1 certificate.
    expect(await startExam(user.userId, [], { area: 'chest', level: 2 }, keys, t0)).toMatchObject({ ok: false, error: expect.stringMatching(/get that certificate first/) });
    const two = await startExam(user.userId, held(1), { area: 'chest', level: 2 }, keys, t0);
    if (!two.ok) throw new Error(two.error);
    expect(two.exam.items).toHaveLength(25);
    expect(two.exam.items.filter((it) => it.taskId.startsWith('mark')).length).toBeGreaterThanOrEqual(13);
    expect(await startExam(user.userId, held(1), { area: 'chest', level: 1 }, keys, t0)).toMatchObject({ ok: false, error: 'You already hold this certificate.' });
    expect((await startExam(user.userId, [], { area: 'everything', level: 1 }, keys, t0)).ok).toBe(false);
    // Starting a new exam ends the open one.
    expect((fake.kv.get(examKey(s.exam.id)) as ServerExam).finishedAt).toBeTruthy();
  });

  it('grades each answer from the marks or choice as given, once, and refuses anything else', async () => {
    const s = await startExam(user.userId, [], { area: 'chest', level: 1 }, keys, t0);
    if (!s.ok) throw new Error(s.error);
    const id = s.exam.id;
    const i = s.exam.items.findIndex((it) => it.taskId.startsWith('choice'));
    const taskId = s.exam.items[i].taskId;
    // A grade sent with the answer, a different question, or another learner's exam: refused.
    expect((await answerQuestion(user.userId, { examId: id, index: i, answer: answer(taskId, { grade: { outcome: 'correct' } }) }, keys, t0)).ok).toBe(false);
    expect((await answerQuestion(user.userId, { examId: id, index: i, answer: answer('choice-59') }, keys, t0)).ok).toBe(false);
    expect((await answerQuestion(other.userId, { examId: id, index: i, answer: answer(taskId) }, keys, t0)).ok).toBe(false);
    expect((await answerQuestion(user.userId, { examId: id, index: i, answer: answer(taskId, { mode: 'practice' }) }, keys, t0)).ok).toBe(false);
    // The right answer (the view left on another series of the patient does not matter), then a second answer.
    const elsewhere = { position: { seriesUid: 'another-series', sopInstanceUid: null, worldLps: null } };
    expect((await answerQuestion(user.userId, { examId: id, index: i, answer: answer(taskId, elsewhere) }, keys, t0)).ok).toBe(true);
    expect(await answerQuestion(user.userId, { examId: id, index: i, answer: answer(taskId, { choice: ['b'] }) }, keys, t0)).toMatchObject({ ok: false, error: 'This question has already been answered.' });
    // A hint used counts as wrong.
    const j = s.exam.items.findIndex((it, k) => k !== i && it.taskId.startsWith('choice'));
    await answerQuestion(user.userId, { examId: id, index: j, answer: answer(s.exam.items[j].taskId, { hintsUsed: [1] }) }, keys, t0);
    const e = fake.kv.get(examKey(id)) as ServerExam;
    expect(e.questions[i].outcome).toBe('correct');
    expect(e.questions[j].outcome).toBe('incorrect');
  });

  it('keeps the clock from Level 2: open first, and an answer after the time counts as out of time', async () => {
    const s = await startExam(user.userId, held(1), { area: 'chest', level: 2 }, keys, t0);
    if (!s.ok) throw new Error(s.error);
    const id = s.exam.id;
    const i = s.exam.items.findIndex((it) => it.taskId.startsWith('choice'));
    const taskId = s.exam.items[i].taskId;
    expect(await answerQuestion(user.userId, { examId: id, index: i, answer: answer(taskId) }, keys, t0)).toMatchObject({ ok: false, error: 'Open the question before answering it.' });
    expect(await openQuestion(user.userId, { examId: id, index: i }, t0)).toEqual({ ok: true, openedAt: t0.toISOString() });
    // Opening again keeps the first time.
    expect(await openQuestion(user.userId, { examId: id, index: i }, at(100))).toEqual({ ok: true, openedAt: t0.toISOString() });
    await answerQuestion(user.userId, { examId: id, index: i, answer: answer(taskId) }, keys, at(180 + 16));
    expect((fake.kv.get(examKey(id)) as ServerExam).questions[i].outcome).toBe('timeout');
  });

  it('scores the exam itself: half points up to Level 2, none at Level 3', async () => {
    // Level 1: 15 questions, all three-answer ones, 10 right = 67%: not passed.
    const fail = await takeExam(1, 10);
    expect(fail.result).toMatchObject({ points: 10, questions: 15, passed: false });
    fake.kv.clear();
    fake.sets.clear();
    const pass = await takeExam(1, 11);
    expect(pass.result).toMatchObject({ points: 11, questions: 15, passed: true });
    // Finishing again returns the same verdict.
    expect((await finishExam(user.userId, { examId: pass.exam.id }, at(2000))).ok && (await finishExam(user.userId, { examId: pass.exam.id }, at(2000)))).toMatchObject({ result: pass.result });
  });

  it('makes a failed higher level wait before it is tried again', async () => {
    const { result } = await takeExam(2, 0);
    expect(result.passed).toBe(false);
    const again = await startExam(user.userId, held(1), { area: 'chest', level: 2 }, keys, at(1000 + 60));
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/try this exam again in 5\d min/) });
    expect((await startExam(user.userId, held(1), { area: 'chest', level: 2 }, keys, at(1000 + 3601))).ok).toBe(true);
  });
});

describe('certificates issued for a passed exam, once', () => {
  it('issues only for this learner’s passed, finished exam of that level', async () => {
    const fail = await takeExam(1, 10);
    expect(await claimCertificate(user, claim(fail.exam.id))).toMatchObject({ ok: false, error: expect.stringMatching(/not passed/) });
    fake.kv.clear();
    fake.sets.clear();
    const pass = await takeExam(1, 13);
    expect((await claimCertificate(other, claim(pass.exam.id))).ok).toBe(false);
    expect((await claimCertificate(user, claim(pass.exam.id, { level: 2 }))).ok).toBe(false);
    // Numbers sent by the app are refused: the server looks the result up itself.
    expect((await claimCertificate(user, { ...claim(pass.exam.id), patients: 999, judged: 999, accuracy: 1 })).ok).toBe(false);
    const [a, b] = await Promise.all([claimCertificate(user, claim(pass.exam.id)), claimCertificate(user, claim(pass.exam.id, { name: 'Another name' }))]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.certificate.id).toMatch(/^RAD-\d{4}-[A-F0-9]{16}$/);
    expect(b.certificate).toEqual(a.certificate);
    expect(a.certificate).toMatchObject({
      title: 'Chest Imaging',
      level: 1,
      patients: 15,
      judged: 15,
      accuracy: 0.867,
      verification: 'server-graded',
      status: 'active',
      exam: { questions: 15, passMark: 0.7, secondsPerQuestion: null, partialCredit: true },
    });
    expect(a.certificate.requirements).toMatch(/^An exam of 15 questions on real patients/);
    expect(await myCertificates(user)).toHaveLength(1);
    expect(await publicCertificate('../../etc')).toBeNull();
  });

  it('issues Level 2 only to someone holding Level 1', async () => {
    const { exam } = await takeExam(2, 25, held(1));
    // Say it passed (the marked questions are not answered here), but without the Level 1 certificate held.
    const e = fake.kv.get(examKey(exam.id)) as ServerExam;
    fake.kv.set(examKey(exam.id), { ...e, result: { ...e.result!, passed: true } });
    expect(await claimCertificate(user, claim(exam.id, { level: 2 }))).toMatchObject({ ok: false, error: expect.stringMatching(/Level 1 · Foundation: get that certificate first/) });
  });

  it('retains legacy records and original issuance after revocation, keeping reasons private', async () => {
    const id = 'abcDEF123_-x';
    const original = { area: 'chest', level: 1, name: 'Ada Lovelace', id, title: 'Chest Imaging', patients: 12, judged: 12, accuracy: 0.8, issuedAt: '2026-10-29T00:00:00Z' };
    fake.kv.set(`rvm:cert:${id}`, original);
    fake.kv.set(`rvm:certs:${user.userId}`, [id]);
    expect((await myCertificates(user))[0]).toMatchObject({ verification: 'legacy-self-reported', status: 'active' });
    await revokeCertificate('admin', { id, reason: 'Duplicate account investigation' });
    expect(await publicCertificate(id)).toMatchObject({ status: 'revoked', name: original.name });
    expect(await publicCertificate(id)).not.toHaveProperty('reason');
    expect(fake.kv.get(`rvm:cert:${id}`)).toEqual(original);
  });

  it('sends only queued completion email, escapes names and avoids duplicate sends', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test');
    vi.stubEnv('EMAIL_FROM', 'Radiology <radiology@example.test>');
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const { exam } = await takeExam(1, 15);
    const c = await claimCertificate(user, claim(exam.id, { name: 'Ada <script>' }));
    if (!c.ok) throw new Error('not issued');
    expect((await sendCertificateEmails()).sent).toBe(0);
    await queueCertificateEmail(c.certificate, user.email);
    expect((await sendCertificateEmails()).sent).toBe(1);
    await queueCertificateEmail(c.certificate, user.email);
    expect((await sendCertificateEmails()).sent).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const mail = certificateMail(c.certificate);
    expect(mail.html).toContain('Ada &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain(`/verify/${c.certificate.id}`);
  });

  it('passes complete LinkedIn fields with a numeric organization ID or brand-name fallback', () => {
    const c = { id: 'RAD-2026-1234567890ABCDEF', title: 'Course completion', issuedAt: '2026-10-30T12:00:00Z' };
    const q = new URL(linkedinCredentialUrl(c, 'https://www.radiology.monster')).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      startTask: 'CERTIFICATION_NAME',
      organizationName: 'radiology.monster',
      issueYear: '2026',
      issueMonth: '10',
      certId: c.id,
      certUrl: `https://www.radiology.monster/verify/${c.id}`,
    });
    expect(new URL(linkedinCredentialUrl(c, 'https://www.radiology.monster', '123')).searchParams.get('organizationId')).toBe('123');
  });
});
