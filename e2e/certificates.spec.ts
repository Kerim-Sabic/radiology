/**
 * The Certificates tab (members): three levels for each body area and for the whole library, the certificates the
 * account holds, and the example certificate anyone can open.
 */
import { expect, test } from './member';
import { CERT_AREAS, CERT_TITLES, LEVELS } from '../shared/certificateLevels';

const emptyProgress = () =>
  CERT_AREAS.flatMap((area) =>
    LEVELS[area === 'all' ? 'all' : 'area'].map((rule) => ({
      area,
      title: CERT_TITLES[area],
      level: rule.level,
      levelName: rule.name,
      patients: 120,
      read: 0,
      judged: 0,
      accuracy: null,
      needPatients: rule.minPatients,
      needJudged: rule.minJudged,
      minAccuracy: rule.minAccuracy,
      independent: rule.independent,
      eligible: false,
      progress: 0,
      todo: 'Complete more server-graded patients.',
    })),
  );
test.beforeEach(async ({ page }) => {
  let count = 0;
  await page.route('**/api/certificates/progress', (r) =>
    r.fulfill({
      json: { statuses: emptyProgress().map((s) => ({ ...s, read: count })) },
    }),
  );
  await page.route('**/api/certificates/answers', (r) => {
    count++;
    return r.fulfill({ json: { results: [{ ok: true, counted: true }] } });
  });
});

test('the certificates tab shows every level, what each asks for, and the certificates held', async ({ page }) => {
  await page.route('**/api/certificates', (r) =>
    r.fulfill({
      json: {
        certificates: [
          {
            id: 'abcDEF123_-x',
            name: 'Test Member',
            area: 'chest',
            level: 1,
            title: 'Chest imaging',
            patients: 12,
            judged: 14,
            accuracy: 0.8,
            issuedAt: '2026-10-29T10:00:00.000Z',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('link', { name: 'Certificates' }).first().click();
  await expect(page).toHaveURL(/\/certificates$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Certificates' })).toBeVisible();
  const levels = page.locator('.certs-levels');
  await expect(levels).toContainText('Level 1 · Foundation');
  await expect(levels).toContainText('Level 2 · Intermediate');
  await expect(levels).toContainText('Level 3 · Advanced');
  await expect(levels).toContainText('30 graded answers without hints · 85% right');
  for (const title of ['Chest Imaging', 'Neuroimaging', 'Breast Imaging', 'General Radiology']) await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  // Three levels in every area, each with its progress.
  const chest = page.locator('section.certs-area', {
    has: page.getByRole('heading', { name: 'Chest Imaging' }),
  });
  await expect(chest.locator('.certs-ladder > li')).toHaveCount(3);
  await expect(
    chest.getByRole('progressbar', {
      name: /Chest Imaging, Level 3 · Advanced/,
    }),
  ).toBeVisible();
  // The certificate held: listed, and marked on its level.
  await expect(page.locator('.certs-mine')).toContainText('Level 1 · Foundation');
  await expect(page.locator('.certs-mine').getByRole('link', { name: /View and share/ })).toHaveAttribute('href', '/verify/abcDEF123_-x');
  await expect(chest.locator('.certs-ladder > li').first()).toContainText('Issued');
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

test('start certification: the app opens the patient a level needs, then the next one after each answer', async ({ page }) => {
  await page.goto('/certificates');
  await expect(page.locator('.certs-how')).toContainText('Start certification');
  await expect(page.locator('.certs-how')).toContainText('Finish certification');
  const chest = page.locator('section.certs-area', {
    has: page.getByRole('heading', { name: 'Chest Imaging' }),
  });
  await chest
    .getByRole('button', { name: /Start certification/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/read\/[^?]+\?task=.+&mode=practice&cert=chest-1$/);
  const bar = page.locator('.ws-cert');
  await expect(bar).toContainText('Chest Imaging · Level 1 · Foundation');
  await expect(bar).toContainText('0/10 patients');
  const first = new URL(page.url()).pathname;
  // Answer in the quickest honest way (first option, or "not assessable").
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  const options = page.getByRole('group', { name: 'Answer options' }).locator('input');
  if (await options.count()) await options.first().check();
  else if (await page.getByRole('button', { name: 'Not visible / not assessable' }).count()) await page.getByRole('button', { name: 'Not visible / not assessable' }).click();
  else if (await page.getByRole('button', { name: 'No abnormality found' }).count()) await page.getByRole('button', { name: 'No abnormality found' }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(bar).toContainText('1/10 patients');
  await page.getByRole('button', { name: 'Next for your certificate →' }).click();
  await expect(page).toHaveURL(/cert=chest-1$/);
  expect(new URL(page.url()).pathname).not.toBe(first);
  await expect(page.locator('.ws-cert')).toContainText('1/10 patients');
  // Switching mode keeps the certificate.
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Learn' }).click();
  await expect(page).toHaveURL(/cert=chest-1/);
});

test('post it for me: the holder edits the post, LinkedIn is opened to allow it, and the result shows on return', async ({ page }) => {
  const cert = {
    id: 'abcDEF123_-x',
    name: 'Test Member',
    area: 'chest',
    level: 1,
    title: 'Chest Imaging',
    patients: 12,
    judged: 14,
    accuracy: 0.8,
    issuedAt: '2026-10-29T10:00:00.000Z',
  };
  await page.route('**/api/certificate?id=*', (r) => r.fulfill({ json: { certificate: cert } }));
  await page.route('**/api/certificates', (r) => r.fulfill({ json: { certificates: [cert], linkedin: true } }));
  let sent: { id: string; text: string } | null = null;
  // Instead of LinkedIn, come straight back as LinkedIn would after posting.
  await page.route('**/api/linkedin/start', async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({
      json: {
        url: '/certificate/abcDEF123_-x?linkedin=posted&post=urn%3Ali%3Ashare%3A7000000000000000001#add-to-linkedin',
      },
    });
  });
  await page.goto('/certificate/abcDEF123_-x');
  const post = page.getByRole('textbox', { name: 'Post text' });
  await expect(post).toHaveValue(/Proud to share that I have earned the Chest Imaging Certificate – Level 1 \(Foundation\)/);
  await page.getByRole('group', { name: 'Post style' }).getByRole('button', { name: 'Short' }).click();
  await expect(post).toHaveValue(/^Earned the Chest Imaging Certificate/);
  await post.fill('My own words. #radiology');
  await page.getByRole('button', { name: 'Post it on my LinkedIn' }).click();
  await expect(page.locator('.cert-li-result')).toContainText('Posted on your LinkedIn.');
  expect(sent).toEqual({
    id: 'abcDEF123_-x',
    text: 'My own words. #radiology',
  });
  await expect(page.locator('.cert-li-result').getByRole('link', { name: 'See your post' })).toHaveAttribute(
    'href',
    'https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001/',
  );
  // The last step, the profile, is open; the result is not kept in the address.
  await expect(page.locator('#add-to-linkedin')).toBeVisible();
  await expect(page).toHaveURL(/\/certificate\/abcDEF123_-x#add-to-linkedin$/);
});

test('someone else viewing a certificate gets the share links, not the post-for-me button', async ({ page }) => {
  const cert = {
    id: 'abcDEF123_-x',
    name: 'Test Member',
    area: 'chest',
    level: 1,
    title: 'Chest Imaging',
    patients: 12,
    judged: 14,
    accuracy: 0.8,
    issuedAt: '2026-10-29T10:00:00.000Z',
  };
  await page.route('**/api/certificate?id=*', (r) => r.fulfill({ json: { certificate: cert } }));
  await page.route('**/api/certificates', (r) => r.fulfill({ json: { certificates: [], linkedin: true } }));
  await page.goto('/certificate/abcDEF123_-x');
  await expect(page.getByRole('textbox', { name: 'Post text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post it on my LinkedIn' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Post on LinkedIn' })).toHaveAttribute('href', /linkedin\.com\/sharing\/share-offsite/);
});

test('verified completion claims only the chosen name and level, then opens PDF and LinkedIn details', async ({ page }) => {
  const cert = {
    id: 'RAD-2026-1234567890ABCDEF',
    name: 'Ada Lovelace',
    area: 'chest',
    level: 1,
    title: 'Chest Imaging',
    patients: 10,
    judged: 10,
    accuracy: 0.9,
    issuedAt: '2026-10-30T12:00:00Z',
    verification: 'server-graded',
    status: 'active',
  };
  await page.route('**/api/certificates/progress', (r) =>
    r.fulfill({
      json: {
        statuses: emptyProgress().map((s) =>
          s.area === 'chest' && s.level === 1
            ? {
                ...s,
                eligible: true,
                read: 10,
                judged: 10,
                accuracy: 0.9,
                progress: 1,
                todo: null,
              }
            : s,
        ),
      },
    }),
  );
  let payload: unknown;
  await page.route('**/api/certificates', (r) => {
    if (r.request().method() === 'POST') {
      payload = r.request().postDataJSON();
      return r.fulfill({ json: { certificate: cert } });
    }
    return r.fulfill({ json: { certificates: [] } });
  });
  await page.route('**/api/certificate?id=*', (r) => r.fulfill({ json: { certificate: cert } }));
  await page.goto('/certificates');
  await page.locator('#cert-chest-1').getByRole('button', { name: 'Finish certification' }).click();
  await page.getByLabel('Name on the certificate').fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Issue certificate' }).click();
  await expect(page).toHaveURL(/\/verify\/RAD-2026-1234567890ABCDEF#add-to-linkedin$/);
  expect(payload).toEqual({
    area: 'chest',
    level: 1,
    name: 'Ada Lovelace',
    email: false,
  });
  await expect(page.locator('.cert-verify')).toContainText('graded by our server');
  await expect(page.getByRole('link', { name: 'Download PDF with verification QR' })).toHaveAttribute('href', `/api/certificate/pdf?id=${cert.id}`);
  const linkedin = page.getByRole('link', {
    name: 'Open LinkedIn’s certification form',
  });
  await expect(linkedin).toHaveAttribute('href', /certUrl=.*verify%2FRAD-2026/);
  await expect(page.locator('#add-to-linkedin')).toContainText('best-effort');
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
