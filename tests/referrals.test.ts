import { describe, expect, it } from 'vitest';
import { affiliateCode } from '../shared/referrals';
import { rememberReferral } from '../src/auth/referralAttribution';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe('referral attribution', () => {
  it('retains a link through email sign-in and return visits, then expires it', () => {
    const saved = storage();
    expect(rememberReferral('?a=Study-Pal', saved, 1000)).toBe('study-pal');
    expect(rememberReferral('?account=verified', saved, 2000)).toBe('study-pal');
    expect(rememberReferral('', saved, 1000 + 30 * 86400000)).toBeUndefined();
  });
  it('uses the newest explicit link without letting malformed input overwrite it', () => {
    const saved = storage();
    rememberReferral('?a=first', saved, 1000);
    expect(rememberReferral('?a=second', saved, 2000)).toBe('second');
    expect(rememberReferral('?a=https://evil.test', saved, 3000)).toBe('second');
  });
  it('still works if storage is blocked and recovers from corrupt saved data', () => {
    const blocked = { setItem: () => { throw new Error('blocked'); }, getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(rememberReferral('?a=student', blocked)).toBe('student');
    expect(rememberReferral('', blocked)).toBeUndefined();
    const saved = storage(); saved.setItem('rvm:referral:v1', '{');
    expect(rememberReferral('', saved)).toBeUndefined();
  });
  it.each(['', 'name@example.com', 'https://evil.test', '<script>', '../secret', 'a'.repeat(101), null, 1])('rejects an invalid referral code %s', value => {
    expect(affiliateCode(value)).toBeUndefined();
  });
});
