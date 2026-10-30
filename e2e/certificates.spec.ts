/**
 * The Certificates tab (members): three levels for each body area and for the whole library, each an exam, the
 * certificates the account holds, and the example certificate anyone can open.
 */
import { expect, test } from './member';
import { mockExamServer } from './examServer';

test('the certificates tab shows every level as an exam, and the certificates held', async ({ page }) => {
  await page.route('**/api/certificates', (r) =>
    r.fulfill({ json: { certificates: [{ id: 'abcDEF123_-x', name: 'Test Member', area: 'chest', level: 1, title: 'Chest imaging', patients: 15, judged: 15, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z', exam: { questions: 15, passMark: 0.7, secondsPerQuestion: null, partialCredit: true } }] } }),
  );
  await page.goto('/');
  await page.getByRole('link', { name: 'Certificates' }).first().click();
  await expect(page).toHaveURL(/\/certificates$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Certificates' })).toBeVisible();
  const levels = page.locator('.certs-levels');
  await expect(levels).toContainText('Level 1 · Foundation');
  await expect(levels).toContainText('Level 3 · Advanced');
  await expect(levels).toContainText('15 questions · untimed · pass mark 70%');
  await expect(levels).toContainText('25 questions · 3 min each · pass mark 80%');
  await expect(levels).toContainText('40 questions · 2 min each · pass mark 90% · no half points');
  await expect(levels).toContainText('75 questions from all 5 body areas');
  await expect(levels).toContainText('subtle cases first · needs Level 2');
  await expect(page.locator('.certs-how')).toContainText('No hints, and no result until the end');
  await expect(page.locator('.certs-how')).toContainText('pass one to unlock the next');
  for (const title of ['Chest Imaging', 'Neuroimaging', 'Breast Imaging', 'General Radiology']) await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  const chest = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Chest Imaging' }) });
  await expect(chest.locator('.certs-ladder > li')).toHaveCount(3);
  // The certificate held: listed, and marked on its level, which can be retaken.
  await expect(page.locator('.certs-mine')).toContainText('passed with 80%');
  await expect(page.locator('.certs-mine').getByRole('link', { name: /View and share/ })).toHaveAttribute('href', '/verify/abcDEF123_-x');
  await expect(chest.locator('.certs-ladder > li').first()).toContainText('Issued');
  // The levels go in order: Level 2 is open with Level 1 held, Level 3 waits for Level 2; another area starts at Level 1.
  await expect(chest.locator('.certs-ladder > li').nth(1).getByRole('button', { name: /Start the exam/ })).toBeVisible();
  await expect(chest.locator('.certs-ladder > li').nth(2)).toContainText('Level 2 first');
  await expect(chest.locator('.certs-ladder > li').nth(2).getByRole('button', { name: /Start the exam/ })).toHaveCount(0);
  const head = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Neuroimaging' }) });
  await expect(head.locator('.certs-ladder > li').first().getByRole('button', { name: /Start the exam/ })).toBeVisible();
  await expect(head.locator('.certs-ladder > li').nth(1)).toContainText('Get the Level 1 certificate first.');
  // A small area says when the library cannot fill a level yet.
  const abdomen = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Abdominal and Pelvic Imaging' }) });
  await expect(abdomen.locator('.certs-ladder > li').nth(2)).toContainText('Not enough patients in the library for this level yet');
  await expect(page.getByRole('link', { name: /See an example/ })).toHaveAttribute('href', '/certificate/example');
  // Progress points here.
  await page.goto('/progress');
  await page.getByRole('link', { name: 'Open certificates' }).click();
  await expect(page).toHaveURL(/\/certificates$/);
});

test('the example certificate shows a level and says it is an example', async ({ page }) => {
  await page.goto('/certificate/example');
  await expect(page.locator('.cert-name')).toHaveText('Your Name');
  await expect(page.locator('.cert-line')).toHaveText('has successfully completed');
  await expect(page.locator('.cert-level')).toHaveText('Level 2 · Intermediate');
  await expect(page.locator('.cert-example')).toContainText('This is an example');
  await expect(page.locator('.cert-verify')).toContainText('Chest Imaging Certificate – Level 2 (Intermediate)');
  await expect(page.getByRole('button', { name: 'Add to LinkedIn profile' })).toHaveCount(0);
  await expect(page.locator('.cert-check')).toHaveCount(0);
});

/** Answer the open exam question in the quickest honest way: the first option, "no abnormality", or one mark. */
async function answerQuestion(page: import('./member').Page) {
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  const options = page.getByRole('group', { name: 'Answer options' }).locator('input');
  if (await options.count()) await options.first().check();
  else if (await page.getByRole('button', { name: 'No abnormality found' }).count()) await page.getByRole('button', { name: 'No abnormality found' }).click();
  else {
    await page.locator('.exam-question').getByRole('button', { name: /Point/ }).click();
    await page.locator('[data-panel="p0"] .vp-el').waitFor();
    // A point in the middle of the image, as the viewer's own mouse handling receives it.
    await page.evaluate(() => {
      const el = document.querySelector('[data-panel="p0"] .vp-el')!;
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
      el.dispatchEvent(new MouseEvent('mousemove', { ...o, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    });
    await page.waitForFunction(() => (window as any).__rvm.collectMarks().length > 0, null, { timeout: 5000 });
  }
  await page.locator('.exam-question').getByRole('button', { name: /^Save answer/ }).click();
}

test('the exam: one question after another with no hints or feedback, then passed or not, with every answer to review', async ({ page }) => {
  test.setTimeout(300_000);
  const server = await mockExamServer(page);
  await page.goto('/certificates');
  const chest = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Chest Imaging' }) });
  await chest.getByRole('button', { name: /Start the exam/ }).first().click();
  await expect(page).toHaveURL(/\/read\/[^?]+\?task=.+&mode=assess&exam=exam-/);
  const head = page.locator('.ws-exam');
  await expect(head).toContainText('Exam · Chest Imaging · Level 1 · Foundation');
  await expect(head).toContainText('Question 1 of 15');
  // Only the question: no mode switch, no hints, no "not sure", no written report.
  await expect(page.getByRole('group', { name: 'Mode' })).toBeHidden();
  const q = page.locator('.exam-question');
  await expect(q.getByRole('button', { name: /Hint|Reveal/ })).toHaveCount(0);
  await expect(q.getByRole('button', { name: 'Not sure' })).toHaveCount(0);
  await expect(q.locator('textarea')).toHaveCount(0);
  const first = page.url();
  await answerQuestion(page);
  // Straight on to the next question, without the result.
  await expect(head).toContainText('Question 2 of 15');
  expect(page.url()).not.toBe(first);
  await expect(page.locator('.outcome')).toHaveCount(0);
  // Leaving keeps the exam: the Certificates page offers to continue it.
  await page.goto('/certificates');
  await expect(page.locator('.certs-current')).toContainText('1 of 15 questions answered');
  await page.getByRole('button', { name: /Continue the exam/ }).first().click();
  await expect(head).toContainText('Question 2 of 15');
  for (let i = 2; i <= 15; i++) {
    await expect(head).toContainText(`Question ${i} of 15`);
    if (i === 15) await expect(q.getByRole('button', { name: /finish the exam/ })).toBeVisible();
    await answerQuestion(page);
  }
  await expect(page).toHaveURL(/\/certificates\/exam\/exam-/);
  // The server picked the questions, started each clock, took every answer as given (never a grade) and scored the exam.
  const sent = server.calls.filter((c) => c.path === 'answer');
  expect(sent).toHaveLength(15);
  expect(sent.every((c) => c.body.answer && !('grade' in (c.body.answer as object)) && (c.body.answer as { mode: string }).mode === 'assess')).toBe(true);
  expect(server.calls.filter((c) => c.path === 'finish')).toHaveLength(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Passed' })).toBeVisible();
  await expect(page.locator('.exam-score')).toContainText('pass mark 70%');
  await expect(page.locator('.exam-answers > li')).toHaveCount(15);
  // Review opens the question with the reference and the explanation.
  await page.locator('.exam-answers > li').first().getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(/mode=review/);
});

test('from Level 2 each question has a clock that keeps running, and a question out of time counts as not answered', async ({ page }) => {
  test.setTimeout(180_000);
  const server = await mockExamServer(page);
  const l1 = { id: 'abcDEF123_-x', name: 'Test Member', area: 'chest', level: 1, title: 'Chest Imaging', patients: 15, judged: 15, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' };
  await page.route('**/api/certificates', (r) => r.fulfill({ json: { certificates: [l1] } }));
  await page.goto('/certificates');
  const chest = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Chest Imaging' }) });
  await chest.locator('.certs-ladder > li').nth(1).getByRole('button', { name: /Start the exam/ }).click();
  const head = page.locator('.ws-exam');
  await expect(head).toContainText('Level 2 · Intermediate');
  await expect(head).toContainText('Question 1 of 25');
  const clock = page.locator('.exam-question').getByRole('timer');
  await expect(clock).toContainText(/^\s*[23]:\d\d left/);
  // The question was opened 4 minutes ago (as if the learner had left and come back): its time is up.
  await page.evaluate(async () => {
    const r = indexedDB.open('radiology-visual-mastery');
    const db: IDBDatabase = await new Promise((ok) => (r.onsuccess = () => ok(r.result)));
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const exam = await new Promise<any>((ok) => { const g = store.get('certExam'); g.onsuccess = () => ok(g.result); });
    exam.items[0].startedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    store.put(exam, 'certExam');
    await new Promise((ok) => (tx.oncomplete = ok));
  });
  await page.reload();
  await expect(head).toContainText('Question 2 of 25');
  const first = await page.evaluate(async () => {
    const r = indexedDB.open('radiology-visual-mastery');
    const db: IDBDatabase = await new Promise((ok) => (r.onsuccess = () => ok(r.result)));
    const g = db.transaction('meta').objectStore('meta').get('certExam');
    const exam = await new Promise<any>((ok) => (g.onsuccess = () => ok(g.result)));
    return exam.items[0];
  });
  expect(first).toMatchObject({ timedOut: true, attemptId: null });
  expect(first.submittedAt).toBeTruthy();
  // The clock is the server's, and the server was told the time ran out.
  expect(server.calls.find((c) => c.path === 'open')?.body).toMatchObject({ index: 0 });
  expect(server.calls.find((c) => c.path === 'answer')?.body).toMatchObject({ index: 0, timedOut: true });
});

test('a passed exam issues the certificate in the name given', async ({ page }) => {
  await page.goto('/certificates');
  await expect(page.getByRole('heading', { level: 1, name: 'Certificates' })).toBeVisible();
  // A finished Level 1 exam that the server scored 12 of 15 (passed), as the reading room saves it.
  await page.evaluate(async () => {
    const r = indexedDB.open('radiology-visual-mastery');
    const db: IDBDatabase = await new Promise((ok) => (r.onsuccess = () => ok(r.result)));
    const tx = db.transaction(['attempts', 'meta'], 'readwrite');
    const items = Array.from({ length: 15 }, (_, i) => ({ caseId: `case-${i}`, taskId: `case-${i}:q`, area: 'chest', submittedAt: '2026-10-30T09:00:00.000Z', attemptId: `att-${i}` }));
    for (const [i, it] of items.entries())
      tx.objectStore('attempts').put({
        id: it.attemptId, taskId: it.taskId, caseId: it.caseId, subjectKey: `s${i}`, holdoutGroup: `g${i}`, packId: 'p', lessonVersion: '1', mode: 'assess',
        startedAt: '2026-10-30T08:59:00.000Z', submittedAt: it.submittedAt, durationMs: 1, marks: [], position: null, choice: [], declaredNoFinding: false, uncertain: false,
        report: null, confidence: null, hintsUsed: [], revealed: false, grade: { outcome: i < 12 ? 'correct' : 'incorrect' }, selfReview: null, independent: true, objectiveIds: [], skillDimensions: [],
      });
    const outcomes = items.map((_, i) => (i < 12 ? 'correct' : 'incorrect'));
    const result = { points: 12, questions: 15, score: 0.8, passed: true, patients: 15, areas: 1, outcomes, finishedAt: '2026-10-30T09:01:00.000Z' };
    const exam = { id: 'exam-0123456789abcdef01234567', area: 'chest', level: 1, startedAt: '2026-10-30T08:59:00.000Z', finishedAt: '2026-10-30T09:01:00.000Z', items, result };
    tx.objectStore('meta').put([exam], 'certExamHistory');
    tx.objectStore('meta').put(exam, 'certExam');
    await new Promise((ok) => (tx.oncomplete = ok));
  });
  const cert = {
    id: 'RAD-2026-1234567890ABCDEF',
    name: 'Ada Lovelace',
    area: 'chest',
    level: 1,
    title: 'Chest Imaging',
    patients: 15,
    judged: 15,
    accuracy: 0.8,
    issuedAt: '2026-10-30T09:02:00.000Z',
    verification: 'server-graded',
    status: 'active',
    exam: { questions: 15, passMark: 0.7, secondsPerQuestion: null, partialCredit: true },
  };
  let claimed: Record<string, unknown> | null = null;
  await page.route('**/api/certificates', async (r) => {
    if (r.request().method() === 'POST') {
      claimed = r.request().postDataJSON();
      return r.fulfill({ json: { certificate: cert } });
    }
    return r.fulfill({ json: { certificates: [] } });
  });
  await page.route('**/api/certificate?id=*', (r) => r.fulfill({ json: { certificate: cert } }));
  await page.goto('/certificates/exam/exam-0123456789abcdef01234567');
  await expect(page.getByRole('heading', { level: 1, name: 'Passed' })).toBeVisible();
  await expect(page.locator('.exam-score')).toContainText('80% right (12 of 15 points)');
  await page.getByLabel('Name on the certificate').fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Get my certificate' }).click();
  await expect(page).toHaveURL(/\/verify\/RAD-2026-1234567890ABCDEF#add-to-linkedin$/);
  // Only the name, the level and the exam go to the server: it looks the result up itself.
  expect(claimed).toEqual({ area: 'chest', level: 1, name: 'Ada Lovelace', email: false, examId: 'exam-0123456789abcdef01234567' });
  await expect(page.locator('.cert-stats')).toContainText('Exam score');
  await expect(page.locator('.cert-verify')).toContainText('graded by our server');
  await expect(page.getByRole('link', { name: 'Download PDF with verification QR' })).toHaveAttribute('href', `/api/certificate/pdf?id=${cert.id}`);
  await expect(page.getByRole('link', { name: 'Open LinkedIn’s certification form' })).toHaveAttribute('href', /certUrl=.*verify%2FRAD-2026/);
  // The Certificates page shows the result of the last exam of that level.
  await page.goto('/certificates');
  const chest = page.locator('section.certs-area', { has: page.getByRole('heading', { name: 'Chest Imaging' }) });
  await expect(chest.locator('.certs-ladder > li').first()).toContainText('80%, passed');
});

test('post it for me: the holder edits the post, LinkedIn is opened to allow it, and the result shows on return', async ({ page }) => {
  const cert = { id: 'abcDEF123_-x', name: 'Test Member', area: 'chest', level: 1, title: 'Chest Imaging', patients: 12, judged: 14, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' };
  await page.route('**/api/certificate?id=*', (r) => r.fulfill({ json: { certificate: cert } }));
  await page.route('**/api/certificates', (r) => r.fulfill({ json: { certificates: [cert], linkedin: true } }));
  let sent: { id: string; text: string } | null = null;
  // Instead of LinkedIn, come straight back as LinkedIn would after posting.
  await page.route('**/api/linkedin/start', async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ json: { url: '/certificate/abcDEF123_-x?linkedin=posted&post=urn%3Ali%3Ashare%3A7000000000000000001#add-to-linkedin' } });
  });
  await page.goto('/certificate/abcDEF123_-x');
  const post = page.getByRole('textbox', { name: 'Post text' });
  await expect(post).toHaveValue(/Proud to share that I have earned the Chest Imaging Certificate – Level 1 \(Foundation\)/);
  await page.getByRole('group', { name: 'Post style' }).getByRole('button', { name: 'Short' }).click();
  await expect(post).toHaveValue(/^Earned the Chest Imaging Certificate/);
  await post.fill('My own words. #radiology');
  await page.getByRole('button', { name: 'Post it on my LinkedIn' }).click();
  await expect(page.locator('.cert-li-result')).toContainText('Posted on your LinkedIn.');
  expect(sent).toEqual({ id: 'abcDEF123_-x', text: 'My own words. #radiology' });
  await expect(page.locator('.cert-li-result').getByRole('link', { name: 'See your post' })).toHaveAttribute('href', 'https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001/');
  // The last step, the profile, is open; the result is not kept in the address.
  await expect(page.locator('#add-to-linkedin')).toBeVisible();
  await expect(page).toHaveURL(/\/certificate\/abcDEF123_-x#add-to-linkedin$/);
});

test('someone else viewing a certificate gets the share links, not the post-for-me button', async ({ page }) => {
  const cert = { id: 'abcDEF123_-x', name: 'Test Member', area: 'chest', level: 1, title: 'Chest Imaging', patients: 12, judged: 14, accuracy: 0.8, issuedAt: '2026-10-29T10:00:00.000Z' };
  await page.route('**/api/certificate?id=*', (r) => r.fulfill({ json: { certificate: cert } }));
  await page.route('**/api/certificates', (r) => r.fulfill({ json: { certificates: [], linkedin: true } }));
  await page.goto('/certificate/abcDEF123_-x');
  await expect(page.getByRole('textbox', { name: 'Post text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post it on my LinkedIn' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Post on LinkedIn' })).toHaveAttribute('href', /linkedin\.com\/sharing\/share-offsite/);
});

test('public verification clearly rejects a revoked record and works on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/certificate?id=*', (r) =>
    r.fulfill({
      json: {
        certificate: {
          id: 'RAD-2026-1234567890ABCDEF',
          name: 'Test Learner',
          area: 'chest',
          level: 1,
          title: 'Chest Imaging',
          patients: 10,
          judged: 10,
          accuracy: 0.8,
          issuedAt: '2026-10-30T12:00:00Z',
          status: 'revoked',
          revokedAt: '2026-10-30T14:00:00Z',
          verification: 'server-graded',
        },
      },
    }),
  );
  await page.goto('/verify/RAD-2026-1234567890ABCDEF');
  await expect(page.getByRole('alert')).toContainText('no longer valid');
  await expect(page.getByRole('heading', { name: 'Revoked — no longer valid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to LinkedIn profile' })).toHaveCount(0);
  await expect(page.locator('.cert-name')).toHaveText('Test Learner');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
