import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Task } from '../src/schema/content';
import type { AnswerKeys, Evidence } from '../server/certificateProgress';

const fake = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  sets: new Map<string, Set<string>>(),
  verified: vi.fn(),
}));
vi.mock('../server/store', () => ({
  rateLimit: async () => true,
  db: () => ({
    get: async (k: string) => fake.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && fake.kv.has(k)) return null;
      fake.kv.set(k, v);
      return 'OK';
    },
    del: async (k: string) => fake.kv.delete(k),
    hset: async (k: string, v: object) => fake.kv.set(k, { ...(fake.kv.get(k) as object), ...v }),
    hgetall: async (k: string) => fake.kv.get(k) ?? null,
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
vi.mock('../server/certificateProgress', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifiedProgress: fake.verified,
}));
import { completionStatuses, evidenceKey, recordAnswer } from '../server/certificateProgress';
import { claimCertificate, myCertificates, publicCertificate, revokeCertificate } from '../server/certificates';
import { certificateMail, queueCertificateEmail, sendCertificateEmails } from '../server/certificateEmail';
import { linkedinCredentialUrl } from '../shared/credential';

const user = {
  userId: 'test-user',
  email: 'learner@example.test',
  name: 'Ada',
  tokenHash: 'test',
};
const keys: AnswerKeys = {
  version: 'test',
  targets: {},
  series: {},
  tasks: {},
};
for (let i = 0; i < 45; i++) {
  const task = Task.parse({
    id: `task-${i}`,
    caseId: `case-${i}`,
    type: 'describe_finding',
    title: 'Study task',
    prompt: 'Choose',
    modes: ['learn', 'practice', 'assess'],
    seriesUids: ['series'],
    start: { seriesUid: 'series', slice: 'first', windowPreset: null },
    targets: [],
    grading: {
      kind: 'choice',
      multiple: false,
      options: [
        { id: 'yes', text: 'Yes', correct: true, why: 'Reference' },
        { id: 'no', text: 'No', correct: false, why: 'Incorrect' },
      ],
    },
    scoring: 'authoritative',
    hints: [],
    explanation: 'Reference',
    bookAnchors: [],
    objectiveIds: [],
    skillDimensions: [],
  });
  keys.tasks[task.id] = {
    task,
    caseId: task.caseId,
    patient: `patient-${i}`,
    areas: ['chest'],
    packId: 'test',
    lessonVersion: '1',
    revision: 'r1',
  };
}
const answer = (i: number, changes = {}) => ({
  taskId: `task-${i}`,
  lessonVersion: '1',
  mode: 'practice',
  marks: [],
  position: null,
  choice: ['yes'],
  declaredNoFinding: false,
  hintsUsed: [],
  revealed: false,
  ...changes,
});
const statuses = () => completionStatuses(Object.values((fake.kv.get(evidenceKey(user.userId)) as Record<string, Evidence>) ?? {}), keys);
const claim = { area: 'chest', level: 1, name: 'Ada Lovelace' };
beforeEach(() => {
  fake.kv.clear();
  fake.sets.clear();
  fake.verified.mockImplementation(async () => statuses());
  vi.stubEnv('APP_URL', 'https://www.radiology.monster');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function qualify(n = 10, mode = 'practice') {
  for (let i = 0; i < n; i++) await recordAnswer(user.userId, answer(i, { mode }), keys);
}

describe('server-verified completion and permanent credentials', () => {
  it('rejects fabricated totals and unsupported tasks; recalculates raw answers', async () => {
    expect(
      (
        await claimCertificate(user, {
          ...claim,
          patients: 999,
          judged: 999,
          accuracy: 1,
          title: 'Doctor',
        })
      ).ok,
    ).toBe(false);
    expect((await recordAnswer(user.userId, answer(999), keys)).ok).toBe(false);
    expect((await recordAnswer(user.userId, answer(0, { grade: { outcome: 'correct' } }), keys)).ok).toBe(false);
    expect((await recordAnswer(user.userId, answer(0, { lessonVersion: 'old' }), keys)).ok).toBe(false);
    expect(await recordAnswer(user.userId, answer(0, { choice: ['no'] }), keys)).toMatchObject({ counted: true, outcome: 'incorrect' });
    expect(statuses()[0]).toMatchObject({
      judged: 1,
      accuracy: 0,
      eligible: false,
    });
    await recordAnswer(user.userId, answer(0), keys);
    await recordAnswer(user.userId, answer(0), keys);
    expect(statuses()[0]).toMatchObject({ judged: 1, read: 1, accuracy: 1 });
  });
  it('counts distinct patients, current reference revisions and Assess-only advanced results', async () => {
    await qualify(40);
    expect(
      statuses()
        .filter((s) => s.area === 'chest')
        .map((s) => s.eligible),
    ).toEqual([true, true, false]);
    await qualify(40, 'assess');
    expect(statuses()[2].eligible).toBe(true);
    await recordAnswer(user.userId, answer(0, { mode: 'assess', revealed: true }), keys);
    expect(statuses()[2].eligible).toBe(false);
    const row = fake.kv.get(evidenceKey(user.userId)) as Record<string, Evidence>;
    row['task-1'].version = 'outdated';
    expect(statuses()[0].judged).toBe(39);
    expect(statuses().find((s) => s.area === 'all' && s.level === 1)?.eligible).toBe(false); // breadth is mandatory
  });
  it('atomically issues one immutable record, despite retries and concurrent claims', async () => {
    await qualify();
    const [a, b] = await Promise.all([claimCertificate(user, claim), claimCertificate(user, { ...claim, name: 'Another name' })]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.certificate.id).toMatch(/^RAD-\d{4}-[A-F0-9]{16}$/);
    expect(b.certificate).toEqual(a.certificate);
    const again = await claimCertificate(user, {
      ...claim,
      name: 'Changed name',
      patients: 999,
      accuracy: 1,
      judged: 999,
      title: 'Doctor',
    });
    expect(again.ok && again.certificate).toEqual(a.certificate);
    expect(a.certificate).toMatchObject({
      title: 'Chest Imaging',
      patients: 10,
      judged: 10,
      verification: 'server-graded',
      status: 'active',
    });
    expect(await myCertificates(user)).toHaveLength(1);
    expect(await publicCertificate('../../etc')).toBeNull();
  });
  it('retains legacy records and original issuance after revocation, keeping reasons private', async () => {
    const id = 'abcDEF123_-x';
    const original = {
      ...claim,
      id,
      title: 'Chest Imaging',
      patients: 12,
      judged: 12,
      accuracy: 0.8,
      issuedAt: '2026-10-29T00:00:00Z',
    };
    fake.kv.set(`rvm:cert:${id}`, original);
    fake.kv.set(`rvm:certs:${user.userId}`, [id]);
    expect((await myCertificates(user))[0]).toMatchObject({
      verification: 'legacy-self-reported',
      status: 'active',
    });
    await revokeCertificate('admin', {
      id,
      reason: 'Duplicate account investigation',
    });
    expect(await publicCertificate(id)).toMatchObject({
      status: 'revoked',
      name: original.name,
    });
    expect(await publicCertificate(id)).not.toHaveProperty('reason');
    expect(fake.kv.get(`rvm:cert:${id}`)).toEqual(original);
  });
  it('sends only queued completion email, escapes names and avoids duplicate sends', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test');
    vi.stubEnv('EMAIL_FROM', 'Radiology <radiology@example.test>');
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await qualify();
    const c = await claimCertificate(user, { ...claim, name: 'Ada <script>' });
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
    const c = {
      id: 'RAD-2026-1234567890ABCDEF',
      title: 'Course completion',
      issuedAt: '2026-10-30T12:00:00Z',
    };
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
