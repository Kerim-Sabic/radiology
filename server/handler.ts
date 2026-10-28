import { z } from 'zod';
import { accessFor, checkout } from './billing.js';
import { beginSignIn, cookie, finishSignIn, FLOW_COOKIE, hash, session, SESSION_COOKIE } from './auth.js';
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
export async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  try {
    if (path === '/api/config' && request.method === 'GET') return json(readiness());
    if (!readiness().auth) return json({ error: 'Sign-in is being configured. Please try again shortly.' }, 503);
    if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin' }, 403);
    if (path === '/api/auth/email' && request.method === 'GET') {
      const ip = hash(request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown');
      if (!await rateLimit(`login:${ip}`, 30, 600)) return json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429);
      // Always initiate OAuth on the registered origin, so preview/alias cookies cannot split the flow.
      if (new URL(request.url).origin !== appOrigin()) return redirect(`${appOrigin()}/api/auth/email`);
      const flow = await beginSignIn();
      return redirect(flow.url, [flow.cookie]);
    }
    if (path === '/api/auth/callback' && request.method === 'GET') {
      try { return redirect(appOrigin(), [await finishSignIn(request), cookie(FLOW_COOKIE, '', 0)]); }
      catch { return redirect(`${appOrigin()}/?signin=failed`, [cookie(FLOW_COOKIE, '', 0)]); }
    }
    const user = await session(request);
    if (path === '/api/logout' && request.method === 'POST') {
      if (user) await db().del(`rvm:session:${user.tokenHash}`);
      const response = json({ ok: true });
      response.headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
      return response;
    }
    if (!user) return json({ user: null, error: 'Please sign in. Signing in on another device ends your previous session.' }, 401);
    if (path === '/api/session' && request.method === 'GET') {
      const access = readiness().billing ? await accessFor(user.userId) : { active: false };
      return json({ user: { name: user.name, email: user.email }, access, billingReady: readiness().billing });
    }
    if (!readiness().billing) return json({ error: 'Payments are being configured. Please try again shortly.' }, 503);
    if (path === '/api/access' && request.method === 'GET') {
      const access = await accessFor(user.userId);
      return json(access, access.active ? 200 : 402);
    }
    if (path === '/api/billing/refresh' && request.method === 'POST') {
      if (!await rateLimit(`refresh:${user.userId}`, 15, 60)) return json({ error: 'Please wait a moment before checking again.' }, 429);
      return json({ access: await accessFor(user.userId, true) });
    }
    if (path === '/api/billing/checkout' && request.method === 'POST') {
      if (!await rateLimit(`checkout:${user.userId}`, 10, 60)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const body = z.object({ tier: z.enum(['monthly', 'lifetime']) }).strict().safeParse(await request.json());
      if (!body.success) return json({ error: 'Choose monthly or lifetime access.' }, 400);
      const existing = await accessFor(user.userId, true);
      if (existing.active) return json({ error: 'You already have access. Manage your plan from your account.' }, 409);
      if (existing.pendingMembership) return json({ error: 'You have an existing membership. Open billing in Whop to check its payment before purchasing again.' }, 409);
      return json({ url: await checkout(user.userId, body.data.tier) });
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    // Never log OAuth codes, cookies, API response bodies, or personal details.
    console.error('Account request failed', { path, kind: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'We could not verify your account or payment. Please try again shortly. You have not been given access yet.' }, 503);
  }
}
