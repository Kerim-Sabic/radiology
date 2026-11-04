import { describe, expect, it } from 'vitest';
import { guestCaseId } from '../src/auth/guest';
import { FREE_CASES } from '../src/content/weekly';
import { FREE_EDITION } from '../server/freeEdition.generated';
import { trackable } from '../server/engage';

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

  it('is counted in the funnel when opening and answering a case', () => {
    expect(trackable('guest_open')).toBe('guest_open');
    expect(trackable('guest_answer')).toBe('guest_answer');
    expect(trackable('guest_anything')).toBeNull();
  });
});
