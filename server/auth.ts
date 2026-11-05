import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appOrigin, required } from './config.js';
import { db } from './store.js';
import { markJoined } from './joined.js';
import { adminRole, PERMISSIONS, type Permission } from './roles.js';
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
const emailList = (name: string) => (process.env[name] || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
/** The owner (OWNER_EMAILS; without it, everyone in ADMIN_EMAILS): every permission, and the only one who manages admins. */
export function isOwnerEmail(email: string) {
  const owners = emailList('OWNER_EMAILS');
  return (owners.length ? owners : emailList('ADMIN_EMAILS')).includes(email.trim().toLowerCase());
}
/** Whether a verified email is an exact entry in ADMIN_EMAILS (or is the owner). */
export function isAdminEmail(email: string) {
  return isOwnerEmail(email) || emailList('ADMIN_EMAILS').includes(email.trim().toLowerCase());
}
export interface AdminAccess { owner: boolean; permissions: Permission[]; }
/**
 * What a signed-in account may do as an admin, or null for a user. ADMIN_EMAILS admins may do everything except manage
 * admins; dashboard admins only what the owner gave them. Read on every request, so a change takes effect at once.
 */
export async function adminAccess(userId: string): Promise<AdminAccess | null> {
  const identity = await db().get<{ email: string; emailVerified: boolean }>(`rvm:identity:${userId}`);
  if (identity?.emailVerified !== true) return null;
  if (isOwnerEmail(identity.email)) return { owner: true, permissions: [...PERMISSIONS] };
  if (isAdminEmail(identity.email)) return { owner: false, permissions: [...PERMISSIONS] };
  const role = await adminRole(identity.email);
  return role ? { owner: false, permissions: role.permissions.filter(p => (PERMISSIONS as readonly string[]).includes(p)) } : null;
}
export async function isAdmin(userId: string) {
  return !!(await adminAccess(userId));
}
export async function createSession(profile: { sub: string; email: string; emailVerified: boolean; name?: string; provider?: 'whop' | 'clerk' }) {
  if (profile.emailVerified !== true) throw new Error('Verified email required');
  const token = random();
  const tokenHash = hash(token);
  const provider = profile.provider || 'whop';
  const user: Session = { userId: hash(`${provider}:${profile.sub}`), email: profile.email, name: profile.name || profile.email, tokenHash };
  const tx = db().multi();
  tx.set(`rvm:session:${tokenHash}`, user, { ex: SESSION_SECONDS });
  tx.set(`rvm:device:${user.userId}`, tokenHash, { ex: SESSION_SECONDS });
  if (provider === 'whop') tx.set(`rvm:whop-user:${user.userId}`, profile.sub);
  tx.set(`rvm:identity:${user.userId}`, { email: profile.email, emailVerified: true, provider });
  await tx.exec();
  // The very first sign-in of an account: the welcome email (server/welcome.ts), sent in the background. Loaded on
  // demand, so a sign-in never waits for it and never fails because of it.
  if ((await markJoined(user.userId)) && process.env.WELCOME_EMAIL !== 'off' && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    await import('./welcome.js').then((m) => m.welcomeNewAccount(user)).catch(() => undefined);
  }
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
