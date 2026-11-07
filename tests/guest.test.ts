import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRY_CASE, TRY_CASE_URL, guestCaseId } from '../src/auth/guest';
import { FREE_CASES } from '../src/content/weekly';
import { FREE_EDITION } from '../server/freeEdition.generated';
import { markSeconds, sourceCounted, trackable } from '../server/engage';

describe('a visitor with no account', () => {
  it('opens the reading room only on an always-free sample patient', () => {
    expect(guestCaseId('/read/cxr-00003400-003')).toBe('cxr-00003400-003');
    expect(guestCaseId('/read/starter-ct-chest-01/')).toBe('starter-ct-chest-01');
    for (const path of ['/', '/cases', '/read/pe-pat005', '/read/', '/read/cxr-00003400-003/extra', '/readx/cxr-00003400-003', '/read/%E0%A4%A'])
      expect(guestCaseId(path), path).toBeNull();
  });

  it('is offered the same patients the server opens without an account', () => {
    expect([...FREE_CASES].sort()).toEqual([...FREE_EDITION.always].sort());
  });

  it('is offered from the homepage a free patient and a task that exist', () => {
    expect(FREE_CASES).toContain(TRY_CASE);
    const url = new URL(TRY_CASE_URL, 'https://www.radiology.monster');
    expect(guestCaseId(url.pathname)).toBe(TRY_CASE);
    const lessons = JSON.parse(readFileSync('public/packs/cxr-findings/lessons.json', 'utf8')) as { tasks: Array<{ id: string }> };
    expect(lessons.tasks.map((t) => t.id)).toContain(url.searchParams.get('task'));
    expect(url.searchParams.get('mode')).toBe('practice');
  });

  it('is counted in the funnel when opening and answering a case', () => {
    expect(trackable('guest_open')).toBe('guest_open');
    expect(trackable('guest_answer')).toBe('guest_answer');
    expect(trackable('guest_anything')).toBeNull();
  });

  it('counts the steps between: first mark (with the seconds before it), a second task, the email code, the payment form', () => {
    for (const e of ['guest_mark', 'guest_second', 'code_sent', 'checkout_ready', 'checkout_error'] as const) expect(trackable(e)).toBe(e);
    // The server counts accounts, first answers, checkouts and payments itself; a browser can't add to them, nor to the seconds total.
    for (const e of ['signup', 'studied', 'checkout', 'paid', 'guest_mark_s', 'opened']) expect(trackable(e)).toBeNull();
    expect(markSeconds(12.4)).toBe(12);
    expect(markSeconds(5000)).toBe(600);
    for (const bad of [-1, Number.NaN, '12', null, undefined]) expect(markSeconds(bad)).toBeNull();
    // Campaign rows count the guest steps and the code; plans and payment-form loads are totals only.
    expect(['visit', 'guest_open', 'guest_mark', 'guest_answer', 'guest_second', 'signup_start', 'code_sent'].every((e) => sourceCounted(e as never))).toBe(true);
    expect(sourceCounted('plans')).toBe(false);
    expect(sourceCounted('checkout_ready')).toBe(false);
  });
});
