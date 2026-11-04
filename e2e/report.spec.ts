/**
 * "Report a problem with this case": a learner sends what looks wrong, with the case, task and slice they are on;
 * opening a case counts the funnel's "Opened a first case" step.
 */
import { expect, test } from './member';

const HEART = '/read/starter-ct-chest-01?task=starter-ct-chest-01%3Aheart&mode=practice';

test('a report is sent with the case, the task and the slice on screen', async ({ page }) => {
  const sent: Array<Record<string, any>> = [];
  let refuse = true;
  await page.route('**/api/report', async (r) => {
    if (refuse) {
      refuse = false;
      return r.fulfill({ status: 429, json: { error: 'You have sent several reports in the last hour. Please try again later.' } });
    }
    sent.push(r.request().postDataJSON());
    return r.fulfill({ json: { ok: true, id: 'r1' } });
  });
  const opened = page.waitForRequest((q) => q.url().endsWith('/api/track/opened') && q.method() === 'POST');
  await page.goto(HEART);
  await page.waitForFunction(() => (window as any).__rvm?.panelState('p0')?.ready === true, null, { timeout: 60_000 });
  await opened;
  await page.evaluate(() => (window as any).__rvm.setIndex('p0', 20));

  await page.getByRole('button', { name: 'Report a problem with this case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem with this case' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose what looks wrong.');
  await dialog.getByLabel('Something else').check();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Please say in a few words what looks wrong.');

  await dialog.getByLabel('An outline or label is in the wrong place or wrongly named').check();
  await dialog.getByRole('textbox').fill('The heart outline stops two slices early.');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  // The server's refusal is shown in the form, which keeps what was typed.
  await expect(dialog.getByRole('alert')).toHaveText('You have sent several reports in the last hour. Please try again later.');
  await expect(dialog.getByRole('textbox')).toHaveValue('The heart outline stops two slices early.');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Thank you. Your report was sent with this case and slice.')).toBeVisible();

  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    kind: 'outline',
    text: 'The heart outline stops two slices early.',
    caseId: 'starter-ct-chest-01',
    taskId: 'starter-ct-chest-01:heart',
    mode: 'practice',
    view: { kind: 'stack', slice: 21 },
  });
  expect(sent[0].view.of).toBeGreaterThan(21);
  expect(sent[0].exam).toBeUndefined();

  // The Case tab has the same link; Cancel sends nothing.
  await page.getByRole('tab', { name: 'Case' }).click();
  await page.getByRole('button', { name: 'Report a problem with this case' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(sent).toHaveLength(1);
});
