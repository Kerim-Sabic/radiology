import { describe, expect, it } from 'vitest';
import { withAccount, withoutAccount } from '../src/auth/returnPath';

const ad = { pathname: '/read/cxr-00003400-003', search: '?task=cxr-00003400-003%3Alocate&mode=practice&utm_source=meta&utm_campaign=noarrow_a' };

describe('the page a visitor signs up from', () => {
  it('is kept through the sign-up redirect, with the case, task and tag', () => {
    const back = withAccount('verified', ad);
    expect(back.startsWith('/read/cxr-00003400-003?')).toBe(true);
    const q = new URLSearchParams(back.split('?')[1]);
    expect(q.get('task')).toBe('cxr-00003400-003:locate');
    expect(q.get('mode')).toBe('practice');
    expect(q.get('utm_campaign')).toBe('noarrow_a');
    expect(q.get('account')).toBe('verified');
  });

  it('drops only the account flag afterwards', () => {
    const back = withAccount('verified', ad);
    const [pathname, search] = back.split('?');
    expect(withoutAccount({ pathname, search: `?${search}` })).toBe(`${ad.pathname}${ad.search}`);
    expect(withoutAccount({ pathname: '/', search: '?account=verified' })).toBe('/');
  });

  it('works from the home page as before', () => {
    expect(withAccount('verified', { pathname: '/', search: '' })).toBe('/?account=verified');
    expect(withAccount('login', { pathname: '/', search: '?account=signup' })).toBe('/?account=login');
  });
});
