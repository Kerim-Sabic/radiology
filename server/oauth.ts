import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { required } from './config.js';
import { db } from './store.js';

const jwks = createRemoteJWKSet(new URL('https://api.whop.com/.well-known/jwks.json'));
export interface Tokens { access_token: string; refresh_token: string; expires_in: number; id_token?: string; expiresAt: number; }
export async function exchange(body: Record<string, string>): Promise<Tokens> {
  const response = await fetch('https://api.whop.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, client_id: required('WHOP_APP_ID') }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Whop authorization expired or is unavailable');
  const tokens = await response.json();
  if (typeof tokens.access_token !== 'string' || !Number.isFinite(tokens.expires_in)) throw new Error('Invalid token response');
  return { ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 };
}
export async function identity(tokens: Tokens, nonce: string) {
  if (!tokens.id_token) throw new Error('Missing identity token');
  const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: 'https://api.whop.com', audience: required('WHOP_APP_ID'), algorithms: ['ES256'] });
  if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub.startsWith('user_')) throw new Error('Invalid identity token');
  const response = await fetch('https://api.whop.com/oauth/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Unable to verify profile');
  const profile = await response.json();
  if (profile.sub !== payload.sub || typeof profile.email !== 'string' || profile.email_verified !== true) throw new Error('Verified email required');
  return { sub: profile.sub as string, email: profile.email as string, emailVerified: true as const, name: typeof profile.name === 'string' ? profile.name : undefined };
}
export async function revoke(tokens: Tokens) {
  if (!tokens.refresh_token) return;
  const response = await fetch('https://api.whop.com/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tokens.refresh_token, client_id: required('WHOP_APP_ID') }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Unable to revoke temporary sign-in authorization');
}
function key() {
  const bytes = Buffer.from(required('TOKEN_ENCRYPTION_KEY'), 'base64');
  if (bytes.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 random bytes');
  return bytes;
}
export function encrypt(value: Tokens) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function decrypt(value: string): Tokens {
  const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}
export async function merchantToken(): Promise<string> {
  if (process.env.WHOP_API_KEY) return process.env.WHOP_API_KEY;
  const stored = await db().get<string>('rvm:merchant');
  if (!stored) throw new Error('Connect the merchant account before accepting payment');
  const tokens = decrypt(stored);
  if (tokens.expiresAt > Date.now() + 90000) return tokens.access_token;
  const lock = randomBytes(16).toString('hex');
  if (await db().set('rvm:merchant-refresh', lock, { nx: true, ex: 45 })) {
    try {
      // Re-read after acquiring the lock in case another request just rotated the tokens.
      const latest = decrypt((await db().get<string>('rvm:merchant'))!);
      if (latest.expiresAt > Date.now() + 90000) return latest.access_token;
      const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: latest.refresh_token, company_id: required('WHOP_ACCOUNT_ID') });
      await db().set('rvm:merchant', encrypt(refreshed));
      return refreshed.access_token;
    } finally {
      await db().eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", ['rvm:merchant-refresh'], [lock]);
    }
  }
  // Concurrent requests can use the still-valid token while the winner rotates it.
  if (tokens.expiresAt > Date.now() + 10000) return tokens.access_token;
  throw new Error('Merchant authorization is refreshing. Retry shortly.');
}
