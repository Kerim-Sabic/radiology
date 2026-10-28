import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ verify: vi.fn(), user: vi.fn(), session: vi.fn() }));
vi.mock('@clerk/backend', () => ({ verifyToken: fake.verify, createClerkClient: () => ({ users: { getUser: fake.user }, sessions: { getSession: fake.session } }) }));
import { clerkIdentity } from '../server/clerk';
const request = () => new Request('https://www.radiology.monster/api/auth/session', { headers: { Authorization: 'Bearer signed.test.token' } });
const profile = (status = 'verified') => ({ id: 'user_clerk', primaryEmailAddressId: 'email_primary', emailAddresses: [{ id: 'email_primary', emailAddress: 'Buyer@Example.com', verification: { status } }], banned: false, locked: false, firstName: 'Test', lastName: 'Buyer' });
beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://www.radiology.monster'); vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
  fake.verify.mockResolvedValue({ sub: 'user_clerk', sid: 'sess_test', sts: 'active' });
  fake.user.mockResolvedValue(profile()); fake.session.mockResolvedValue({ status: 'active', userId: 'user_clerk' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('on-page identity verification', () => {
  it('verifies the signed token, active session and primary email on the server', async () => {
    expect(await clerkIdentity(request())).toMatchObject({ sub: 'user_clerk', provider: 'clerk', email: 'buyer@example.com', emailVerified: true });
    expect(fake.verify).toHaveBeenCalledWith('signed.test.token', expect.objectContaining({ authorizedParties: ['https://www.radiology.monster', 'https://www.radiology.monster'] }));
  });
  it('requires an authorization token', async () => {
    await expect(clerkIdentity(new Request(request().url))).rejects.toThrow('Sign in required');
    expect(fake.user).not.toHaveBeenCalled();
  });
  it('rejects unverified primary email even if another email is verified', async () => {
    fake.user.mockResolvedValue({ ...profile('unverified'), emailAddresses: [...profile('unverified').emailAddresses, { id: 'other', emailAddress: 'admin@example.com', verification: { status: 'verified' } }] });
    await expect(clerkIdentity(request())).rejects.toThrow('Verify your email');
  });
  it.each(['revoked', 'expired', 'ended'])('rejects a %s session', async status => {
    fake.session.mockResolvedValue({ status, userId: 'user_clerk' });
    await expect(clerkIdentity(request())).rejects.toThrow('no longer active');
  });
  it('rejects session/user mismatch, banned users and incomplete authentication', async () => {
    fake.session.mockResolvedValue({ status: 'active', userId: 'other' });
    await expect(clerkIdentity(request())).rejects.toThrow('no longer active');
    fake.session.mockResolvedValue({ status: 'active', userId: 'user_clerk' }); fake.user.mockResolvedValue({ ...profile(), banned: true });
    await expect(clerkIdentity(request())).rejects.toThrow('no longer active');
    fake.verify.mockResolvedValue({ sub: 'user_clerk', sid: 'sess_test', sts: 'pending' });
    await expect(clerkIdentity(request())).rejects.toThrow('Complete sign-in');
  });
});
