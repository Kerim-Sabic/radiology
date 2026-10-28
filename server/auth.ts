import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appOrigin, required } from './config.js';
import { db } from './store.js';
import { exchange, identity, revoke } from './oauth.js';

const SESSION_SECONDS = 30 * 86400;
export const SESSION_COOKIE = '__Host-rvm-session';
export const FLOW_COOKIE = '__Host-rvm-oauth';
export interface Session { userId: string; email: string; name: string; tokenHash: string; }
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('base64url');

export function cookie(name: string, value: string, age: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}
export function readCookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
export function equal(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export async function session(request: Request): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!/^[\w-]{43}$/.test(token)) return null;
  const tokenHash = hash(token);
  const found = await db().get<Session>(`rvm:session:${tokenHash}`);
  if (!found) return null;
  // A new sign-in replaces this pointer; old cookies immediately stop authorizing requests.
  if (await db().get<string>(`rvm:device:${found.userId}`) !== tokenHash) return null;
  return { ...found, tokenHash };
}
export async function isAdmin(userId: string) {
  const allowed = (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return false;
  const identity = await db().get<{ email: string; emailVerified: boolean }>(`rvm:identity:${userId}`);
  return identity?.emailVerified === true && allowed.includes(identity.email.trim().toLowerCase());
}
export async function createSession(profile: { sub: string; email: string; emailVerified: boolean; name?: string }) {
  if (profile.emailVerified !== true) throw new Error('Verified email required');
  const token = random();
  const tokenHash = hash(token);
  const user: Session = { userId: hash(`whop:${profile.sub}`), email: profile.email, name: profile.name || profile.email, tokenHash };
  const tx = db().multi();
  tx.set(`rvm:session:${tokenHash}`, user, { ex: SESSION_SECONDS });
  tx.set(`rvm:device:${user.userId}`, tokenHash, { ex: SESSION_SECONDS });
  tx.set(`rvm:whop-user:${user.userId}`, profile.sub);
  tx.set(`rvm:identity:${user.userId}`, { email: profile.email, emailVerified: true });
  await tx.exec();
  return cookie(SESSION_COOKIE, token, SESSION_SECONDS);
}
export async function beginSignIn() {
  const state = random(), nonce = random(), verifier = random();
  await db().set(`rvm:oauth:${hash(state)}`, { nonce, verifier }, { ex: 600 });
  const params = new URLSearchParams({
    client_id: required('WHOP_APP_ID'), redirect_uri: `${appOrigin()}/api/auth/callback`, response_type: 'code',
    scope: 'openid email profile', state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return { url: `https://api.whop.com/oauth/authorize?${params}`, cookie: cookie(FLOW_COOKIE, state, 600) };
}
export async function finishSignIn(request: Request) {
  const url = new URL(request.url), state = url.searchParams.get('state') || '';
  if (!/^[\w-]{43}$/.test(state) || !equal(state, readCookie(request, FLOW_COOKIE))) throw new Error('Invalid OAuth state');
  const flow = await db().getdel<{ nonce: string; verifier: string }>(`rvm:oauth:${hash(state)}`);
  const code = url.searchParams.get('code');
  if (!flow || !code) throw new Error('Expired or canceled sign-in');
  const tokens = await exchange({ grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: `${appOrigin()}/api/auth/callback` });
  try { return await createSession(await identity(tokens, flow.nonce)); }
  finally { await revoke(tokens).catch(() => console.error('Temporary OAuth token revocation failed')); }
}
