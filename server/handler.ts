import { z } from 'zod';
import { accessFor, checkout, referralProfile } from './billing.js';
import { affiliateCode } from '../shared/referrals.js';
import { beginSignIn, cookie, createSession, finishSignIn, FLOW_COOKIE, hash, random, session, SESSION_COOKIE } from './auth.js';
import { clerkIdentity } from './clerk.js';
import { memberBook } from './book.js';
import { appOrigin, readiness } from './config.js';
import { db, rateLimit } from './store.js';

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'Vary': 'Cookie' } });
}
const redirect = (url: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: url, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers });
};
function authResult(ok: boolean, cookies: string[]) {
  const nonce = random(), destination = `${appOrigin()}${ok ? '/' : '/?signin=failed'}`;
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'` });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? 'Signed in' : 'Sign-in interrupted'} · radiology.monster</title></head><body style="font:16px system-ui;background:#0c1016;color:#e7ebf0;padding:40px"><h1>${ok ? 'You’re signed in.' : 'Sign-in wasn’t completed.'}</h1><p>${ok ? 'Returning to your study space…' : 'Close this window and try signing in again.'}</p><a style="color:#8bd4ff" href="${destination}">Return to radiology.monster</a><script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:'rvm-auth',ok:${ok}},${JSON.stringify(appOrigin())});window.close();}else{location.replace(${JSON.stringify(destination)});}</script></body></html>`, { headers });
}
export async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  try {
    if (path === '/api/config' && request.method === 'GET') return json(readiness());
    if (!readiness().auth) return json({ error: 'Sign-in is being configured. Please try again shortly.' }, 503);
    if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin' }, 403);
    if (path === '/api/auth/session' && request.method === 'POST') {
      const ip = hash(request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown');
      if (!await rateLimit(`account-session:${ip}`, 30, 600)) return json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429);
      try {
        const profile = await clerkIdentity(request);
        const response = json({ ok: true });
        response.headers.append('Set-Cookie', await createSession(profile));
        return response;
      } catch { return json({ error: 'We couldn’t verify this sign-in. Please verify your email and try again.' }, 401); }
    }
    if (path === '/api/auth/email' && request.method === 'GET') {
      const ip = hash(request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown');
      if (!await rateLimit(`login:${ip}`, 30, 600)) return json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429);
      // Always initiate OAuth on the registered origin, so preview/alias cookies cannot split the flow.
      if (new URL(request.url).origin !== appOrigin()) return redirect(`${appOrigin()}/api/auth/email`);
      const flow = await beginSignIn();
      return redirect(flow.url, [flow.cookie]);
    }
    if (path === '/api/auth/callback' && request.method === 'GET') {
      try { return authResult(true, [await finishSignIn(request), cookie(FLOW_COOKIE, '', 0)]); }
      catch { return authResult(false, [cookie(FLOW_COOKIE, '', 0)]); }
    }
    const user = await session(request);
    if (path === '/api/logout' && request.method === 'POST') {
      if (user) await db().del(`rvm:session:${user.tokenHash}`);
      const response = json({ ok: true });
      response.headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
      return response;
    }
    if (!user) return json({ user: null, error: 'Please sign in. Signing in on another device ends your previous session.' }, 401);
    if (path === '/api/book') {
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Use GET or HEAD' }, 405);
      if (!(await accessFor(user.userId)).active) return json({ error: 'An active membership is required to read the book.' }, 402);
      return await memberBook(request);
    }
    if (path === '/api/session' && request.method === 'GET') {
      const access = await accessFor(user.userId);
      return json({ user: { name: user.name, email: user.email }, access, billingReady: readiness().billing });
    }
    if (path === '/api/access' && request.method === 'GET') {
      const access = await accessFor(user.userId);
      return json(access, access.active ? 200 : 402);
    }
    if (!readiness().billing) return json({ error: 'Payments are being configured. Please try again shortly.' }, 503);
    if (path === '/api/referrals' && request.method === 'GET') {
      if (!await rateLimit(`referrals:${user.userId}`, 15, 60)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const { shareUrl } = await referralProfile(user.userId);
      return json({ shareUrl });
    }
    if (path === '/api/billing/refresh' && request.method === 'POST') {
      if (!await rateLimit(`refresh:${user.userId}`, 15, 60)) return json({ error: 'Please wait a moment before checking again.' }, 429);
      return json({ access: await accessFor(user.userId, true) });
    }
    if (path === '/api/billing/checkout' && request.method === 'POST') {
      if (!await rateLimit(`checkout:${user.userId}`, 10, 60)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const body = z.object({ tier: z.enum(['monthly', 'yearly']), promoCode: z.string().trim().max(40).optional(), affiliateCode: z.string().max(100).refine(value => !!affiliateCode(value)).optional() }).strict().safeParse(await request.json());
      if (!body.success) return json({ error: 'Choose monthly or yearly access.' }, 400);
      if (body.data.promoCode && (body.data.promoCode.toLowerCase() !== 'nadin' || body.data.tier !== 'monthly')) return json({ error: 'This code is not available for this plan. Choose monthly or remove the code.' }, 400);
      const existing = await accessFor(user.userId, true);
      if (existing.active) return json({ error: 'You already have access. Manage your plan from your account.' }, 409);
      if (existing.pendingMembership) return json({ error: 'You have an existing membership. Open billing in Whop to check its payment before purchasing again.' }, 409);
      return json(await checkout(user.userId, body.data.tier, body.data.promoCode, body.data.affiliateCode));
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    // Never log OAuth codes, cookies, API response bodies, or personal details.
    console.error('Account request failed', { path, kind: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'We could not verify your account or payment. Please try again shortly. You have not been given access yet.' }, 503);
  }
}
