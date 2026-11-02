import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ records: new Map<string, unknown>(), retrieve: vi.fn(), exchange: vi.fn(), identity: vi.fn(), probe: vi.fn(), list: vi.fn(), encrypt: vi.fn() }));
vi.mock('../server/store', () => ({ db: () => ({
  get: async (key: string) => fake.records.get(key) ?? null,
  getdel: async (key: string) => { const value = fake.records.get(key); fake.records.delete(key); return value ?? null; },
  set: async (key: string, value: unknown, opts?: { nx?: boolean }) => { if (opts?.nx && fake.records.has(key)) return null; fake.records.set(key, value); return 'OK'; },
  multi: () => { const writes: [string, unknown][] = []; return { set: (k: string, v: unknown) => writes.push([k, v]), exec: async () => { writes.forEach(([k, v]) => fake.records.set(k, v)); } }; },
  eval: async (_script: string, keys: string[], args: string[]) => { if (fake.records.get(keys[0]) === args[0]) fake.records.delete(keys[0]); },
}) }));
vi.mock('../server/oauth', () => ({ merchantToken: async () => 'old-credential', exchange: fake.exchange, identity: fake.identity, encrypt: fake.encrypt }));
vi.mock('../server/studentDiscount', () => ({ studentCode: fake.probe, STUDENT_READY_KEY: 'rvm:student-discount-ready' }));
vi.mock('@whop/sdk', () => ({ WhopClient: class { accounts = { retrieve: fake.retrieve }; promoCodes = { list: fake.list }; } }));
import { beginMerchantConnect, finishMerchantConnect, MERCHANT_COOKIE, MERCHANT_SCOPES, merchantConnectPage } from '../server/merchantConnect';

beforeEach(() => {
  vi.resetAllMocks(); fake.records.clear();
  fake.records.set('rvm:merchant', 'old-encrypted-credential');
  for (const [key, value] of Object.entries({ APP_URL: 'https://www.radiology.monster', WHOP_API_KEY: '', TOKEN_ENCRYPTION_KEY: 'test', WHOP_APP_ID: 'app_test', WHOP_ACCOUNT_ID: 'biz_test', WHOP_MONTHLY_PLAN_ID: 'plan_monthly' })) vi.stubEnv(key, value);
  fake.retrieve.mockResolvedValue({ id: 'biz_test', owner: { id: 'user_owner' } });
  fake.exchange.mockResolvedValue({ access_token: 'new-secret', refresh_token: 'new-refresh', expiresAt: Date.now() + 3600000 });
  fake.identity.mockResolvedValue({ sub: 'user_owner', emailVerified: true });
  fake.encrypt.mockReturnValue('new-encrypted-credential');
});
afterAll(() => vi.unstubAllEnvs());
const callback = async () => {
  const flow = await beginMerchantConnect();
  const state = new URL(flow.url).searchParams.get('state')!;
  return new Request(`https://www.radiology.monster/api/auth/callback?state=${state}&code=approved-code`, { headers: { cookie: flow.cookie.split(';')[0] } });
};

describe('owner-authorized merchant promo connection', () => {
  it('requests precisely the existing scopes plus promo create/read using PKCE and a secure separate cookie', async () => {
    const flow = await beginMerchantConnect(), url = new URL(flow.url);
    expect(url.origin).toBe('https://api.whop.com');
    expect(url.searchParams.get('scope')).toBe(MERCHANT_SCOPES);
    expect(MERCHANT_SCOPES.split(' ')).toEqual(['openid', 'profile', 'email', 'company:basic:read', 'member:basic:read', 'member:email:read', 'member:manage', 'payment:basic:read', 'plan:basic:read', 'checkout_configuration:create', 'promo_code:create', 'promo_code:basic:read']);
    expect(url.searchParams.get('redirect_uri')).toBe('https://www.radiology.monster/api/auth/callback');
    expect(url.searchParams.get('company_id')).toBe('biz_test');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(flow.cookie).toContain(`${MERCHANT_COOKIE}=merchant.`);
    expect(flow.cookie).toContain('HttpOnly; Secure; SameSite=Lax; Max-Age=600');
    expect(fake.records.get('rvm:merchant')).toBe('old-encrypted-credential');
  });
  it('checks the owner and both permissions before atomically saving the encrypted connection and enabling discounts', async () => {
    await finishMerchantConnect(await callback());
    expect(fake.identity).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'new-secret' }), expect.stringMatching(/^[\w-]{43}$/));
    expect(fake.list).toHaveBeenCalledWith({ account_id: 'biz_test', first: 1 });
    expect(fake.probe).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^merchant-check:/), 'plan_monthly', 600);
    expect(fake.encrypt).toHaveBeenCalledOnce();
    expect(fake.records.get('rvm:merchant')).toBe('new-encrypted-credential');
    expect(fake.records.get('rvm:student-discount-ready')).toBe(true);
    expect(fake.records.has('rvm:merchant-refresh')).toBe(false);
  });
  it.each(['wrong owner', 'wrong business', 'read denied', 'create denied', 'refresh locked'])('preserves the previous connection when %s', async scenario => {
    const request = await callback();
    if (scenario === 'wrong owner') fake.identity.mockResolvedValue({ sub: 'user_attacker' });
    if (scenario === 'wrong business') fake.retrieve.mockResolvedValue({ id: 'biz_other', owner: { id: 'user_owner' } });
    if (scenario === 'read denied') fake.list.mockRejectedValue(new Error('403'));
    if (scenario === 'create denied') fake.probe.mockRejectedValue(new Error('403'));
    if (scenario === 'refresh locked') fake.records.set('rvm:merchant-refresh', 'another-request');
    await expect(finishMerchantConnect(request)).rejects.toThrow();
    expect(fake.records.get('rvm:merchant')).toBe('old-encrypted-credential');
    expect(fake.records.has('rvm:student-discount-ready')).toBe(false);
    expect(fake.encrypt).not.toHaveBeenCalled();
  });
  it('rejects a forged cookie or alias origin before exchanging an authorization code', async () => {
    const request = await callback();
    await expect(finishMerchantConnect(new Request(request.url))).rejects.toThrow('state');
    await expect(finishMerchantConnect(new Request(request.url.replace('www.radiology.monster', 'other.example'), { headers: request.headers }))).rejects.toThrow('state');
    expect(fake.exchange).not.toHaveBeenCalled();
  });
  it('consumes the flow once so a callback cannot be replayed', async () => {
    const request = await callback();
    await finishMerchantConnect(request);
    await expect(finishMerchantConnect(request)).rejects.toThrow('expired');
    expect(fake.exchange).toHaveBeenCalledOnce();
  });
  it('does not replace API key authentication through an OAuth reconnect', async () => {
    vi.stubEnv('WHOP_API_KEY', 'existing-key');
    await expect(beginMerchantConnect()).rejects.toThrow('API key');
    expect(fake.retrieve).not.toHaveBeenCalled();
  });
  it('keeps the reconnect page private, prevents framing and never includes token values', async () => {
    const response = merchantConnectPage(true);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(await response.text()).not.toContain('new-secret');
  });
});
