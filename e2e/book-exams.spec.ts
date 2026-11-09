/**
 * Book exams (chapters 1-13): a reader of the book takes an exam (a multiple-choice question and an essay on six
 * images) and sees the result; a member without the book is told these exams are for readers of the book. The server
 * is stood in for here (`vite preview` serves no /api); its own grading is tested in tests/bookExams.test.ts.
 */
import { expect, test } from './member';
import type { Page } from './member';

const IMG = (n: number) => `/packs/cxr-findings/thumbs/${['dx-0ba0b8a330', 'dx-0cc43597fd', 'dx-23a6d6ebe1', 'dx-23f9f84250', 'dx-250904dd54', 'dx-ef3021541f'][n]}.png`;
const questions = [
  { id: 'c07-m01', type: 'mcq', prompt: 'Roughly how much fluid blunts the costophrenic angle on a frontal film?', options: ['About 5 mL', 'About 200 to 300 mL', 'About 2 litres', 'About 20 mL'] },
  { id: 'c07-e01', type: 'essay', prompt: 'Describe the findings on these films in two to four sentences.', images: [0, 1, 2, 3, 4, 5].map((i) => ({ thumb: IMG(i), caption: `Image ${i + 1} · Chest, frontal` })), points: 6, minWords: 12 },
];
const chapters = [
  { chapter: 7, title: 'Recognizing a Pleural Effusion', blurb: 'Blunting, the meniscus and CT.', mcq: 1, essays: 1, points: 7, record: null },
  { chapter: 8, title: 'Recognizing Pneumonia', blurb: 'Patterns and follow-up.', mcq: 1, essays: 1, points: 7, record: { best: 80, bestPoints: 6, last: 71, attempts: 2, lastAt: '2026-11-08T10:00:00.000Z', lastAttempt: 'bx-0123456789abcdef01234567' } },
];

async function readerOfTheBook(page: Page) {
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'Test Member', email: 'student@stu.ssst.edu.ba' }, access: { active: true, tier: 'lifetime', expiresAt: null }, billingReady: true, book: true } }));
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  let result: Record<string, unknown> | null = null;
  await page.route('**/api/book-exams**', async (r) => {
    const url = new URL(r.request().url());
    const sub = url.pathname.replace('/api/book-exams', '');
    if (sub === '') return r.fulfill({ json: { passMark: 0.7, chapters } });
    const body = r.request().method() === 'POST' ? (r.request().postDataJSON() as Record<string, unknown>) : {};
    sent.push({ path: sub, body });
    if (sub === '/start') return r.fulfill({ json: { ok: true, attemptId: 'bx-aaaaaaaaaaaaaaaaaaaaaaaa', chapter: 7, title: chapters[0].title, startedAt: new Date().toISOString(), questions } });
    if (sub === '/finish') {
      const answers = body.answers as Record<string, unknown>;
      const right = answers['c07-m01'] === 1;
      result = {
        attemptId: 'bx-aaaaaaaaaaaaaaaaaaaaaaaa', chapter: 7, title: chapters[0].title, finishedAt: new Date().toISOString(), points: (right ? 1 : 0) + 4, total: 7, percent: right ? 71 : 57, passed: right,
        questions: [
          { id: 'c07-m01', type: 'mcq', level: 'recall', prompt: questions[0].prompt, options: (questions[0] as { options: string[] }).options, picked: (answers['c07-m01'] as number | null) ?? null, correct: 1, explanation: 'The frontal film needs about 200 to 300 mL; the lateral view shows less fluid sooner.', book: 'Chapter 7, Radiographic signs of pleural effusion', lesson: null, earned: right ? 1 : 0, max: 1 },
          { id: 'c07-e01', type: 'essay', prompt: questions[1].prompt, images: (questions[1] as { images: Array<{ thumb: string; caption: string }> }).images, answer: String(answers['c07-e01'] ?? ''), rubric: [{ id: 'r1', label: 'Blunting of the costophrenic angle', points: 3, found: true, confirmed: true }, { id: 'r2', label: 'A meniscus', points: 3, found: false, confirmed: false }], model: 'Blunted angle, a meniscus and a dense lower zone.', book: 'Chapter 7, Radiographic signs of pleural effusion', earned: 3, max: 6, selfChecked: false },
        ],
      };
      return r.fulfill({ json: { ok: true, result } });
    }
    if (sub === '/review' && result) {
      const checked = body.checked as string[];
      const q = (result.questions as Array<Record<string, unknown>>)[1];
      q.rubric = (q.rubric as Array<{ id: string; points: number; confirmed: boolean }>).map((x) => ({ ...x, confirmed: checked.includes(x.id) }));
      q.earned = (q.rubric as Array<{ points: number; confirmed: boolean }>).filter((x) => x.confirmed).reduce((n, x) => n + x.points, 0);
      q.selfChecked = true;
      return r.fulfill({ json: { ok: true, result } });
    }
    if (sub === '/attempt' && result) return r.fulfill({ json: { ok: true, finished: true, result } });
    return r.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return sent;
}

test('a reader of the book takes an exam: one multiple-choice question and an essay on six images, then sees the result', async ({ page }) => {
  const sent = await readerOfTheBook(page);
  await page.goto('/book-exams');
  await expect(page.getByRole('heading', { level: 1, name: 'Book exams' })).toBeVisible();
  await expect(page.locator('.bx-chapter')).toHaveCount(2);
  await expect(page.locator('.bx-chapter[data-chapter="8"]')).toContainText('80%');
  await expect(page).toHaveTitle(/Book exams/);
  await page.locator('.bx-chapter[data-chapter="7"]').getByRole('button', { name: /Start/ }).click();
  await expect(page).toHaveURL(/\/book-exams\/chapter\/7$/);
  // Question 1: nothing shows whether an answer is right while the exam is open.
  await expect(page.locator('.bx-prompt')).toContainText('blunts the costophrenic angle');
  await page.getByRole('radio', { name: /200 to 300 mL/ }).click();
  await expect(page.getByRole('radio', { name: /200 to 300 mL/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.bx-expl')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next' }).click();
  // Question 2: six images, enlarged with the arrow keys, and a written answer.
  await expect(page.locator('.bx-thumb')).toHaveCount(6);
  const loaded = await page.locator('.bx-thumb img').evaluateAll((els) => (els as HTMLImageElement[]).map((e) => e.complete && e.naturalWidth > 0));
  expect(loaded.every(Boolean)).toBe(true);
  await page.locator('.bx-thumb').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Image 2 · Chest, frontal');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByPlaceholder(/Write what you see/).fill('There is blunting of the costophrenic angle on the right with a concave upper edge, a meniscus, and a dense lower zone.');
  await page.getByRole('button', { name: /Finish the exam/ }).click();
  await expect(page.getByRole('alertdialog')).toContainText('All questions are answered');
  await page.getByRole('button', { name: 'Finish and see the result' }).click();
  // The result: the score, the explanation with the book pointer, the rubric and the model answer.
  await expect(page).toHaveURL(/\/book-exams\/result\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chapter 7: 71%');
  await expect(page.locator('.bx-verdict')).toContainText('Passed');
  await expect(page.locator('.bx-item[data-id="c07-m01"]')).toContainText('Book: Chapter 7, Radiographic signs of pleural effusion');
  await expect(page.locator('.bx-item[data-id="c07-m01"] .bx-expl')).toContainText('lateral view');
  await expect(page.locator('.bx-item[data-id="c07-e01"] .bx-model')).toContainText('Blunted angle');
  expect(sent.find((s) => s.path === '/finish')?.body.answers).toMatchObject({ 'c07-m01': 1 });
  // The learner confirms a second rubric item: the essay's points follow.
  await page.locator('.bx-item[data-id="c07-e01"]').getByRole('checkbox', { name: /A meniscus/ }).click();
  await expect(page.locator('.bx-item[data-id="c07-e01"] .bx-rubric')).toContainText('6 of 6 points');
});

test('on a phone the exam fits the screen and the images swipe in a strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await readerOfTheBook(page);
  await page.goto('/book-exams/chapter/7');
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.bx-thumb')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const strip = page.locator('.bx-strip');
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.locator('.bx-dots')).toContainText('of 6');
});

test('a member without the book is told these exams are for readers of the book', async ({ page }) => {
  let asked = false;
  await page.route('**/api/book-exams**', (r) => {
    asked = true;
    return r.fulfill({ status: 403, json: { error: 'no' } });
  });
  await page.goto('/book-exams');
  await expect(page.getByRole('heading', { level: 2, name: 'These exams are for readers of the book' })).toBeVisible();
  await expect(page.locator('.bx-chapter')).toHaveCount(0);
  expect(asked).toBe(false);
  // The server says no as well, if the page is reached some other way.
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: { name: 'T', email: 'x@example.com' }, access: { active: true, tier: 'lifetime', expiresAt: null }, billingReady: true, book: true } }));
  await page.goto('/book-exams');
  await expect(page.getByRole('heading', { level: 2, name: 'These exams are for readers of the book' })).toBeVisible();
});
