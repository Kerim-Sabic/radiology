import { z } from 'zod';
import { accessFor, checkout, referralProfile } from './billing.js';
import { affiliateCode } from '../shared/referrals.js';
import { beginSignIn, cookie, createSession, finishSignIn, FLOW_COOKIE, hash, random, session, SESSION_COOKIE } from './auth.js';
import { clerkIdentity } from './clerk.js';
import { bookGift, memberBook, servesBook } from './book.js';
import { appOrigin, readiness } from './config.js';
import { db, rateLimit } from './store.js';
import { adminStats, count, countOnce, cronAuthorized, dailyCron, emailPrefs, recordActivity, trackable, unsubscribe, weeklyCron } from './engage.js';
import { claimCertificate, myCertificates, publicCertificate } from './certificates.js';
import { certificateImage, certificatePageHtml } from './certificateShare.js';
import { isAdmin } from './auth.js';

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
    const url = new URL(request.url);
    const ip = () => hash(request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown');
    // Links in emails, and the mail app's one-click unsubscribe (a POST from the mail provider, so before the origin check).
    if (path === '/api/email/unsubscribe' && ['GET', 'POST'].includes(request.method)) {
      const ok = await unsubscribe(url);
      return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences · radiology.monster</title></head><body style="font:16px -apple-system,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;padding:48px 20px;text-align:center"><h1 style="font-size:22px">${ok ? 'You will not get these emails again.' : 'This link is not valid.'}</h1><p>${ok ? 'You can turn them back on in Settings.' : 'Change your email choices in Settings.'}</p><a href="/" style="color:#2563eb">radiology.monster</a></body></html>`, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (path.startsWith('/api/cron/') && request.method === 'GET') {
      if (!cronAuthorized(request)) return json({ error: 'Not allowed' }, 401);
      if (path === '/api/cron/daily') return json(await dailyCron());
      if (path === '/api/cron/weekly') return json(await weeklyCron());
      return json({ error: 'Not found' }, 404);
    }
    // A shared certificate link: the page with its own preview tags, and the preview picture (public, for link crawlers).
    if (path === '/api/certificate-page' && request.method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const [cert, index] = await Promise.all([publicCertificate(id), fetch(new URL('/index.html', appOrigin())).then((r) => r.text())]);
      return new Response(certificatePageHtml(index, cert, appOrigin(), id), { status: cert || id === 'example' ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
    }
    if (path === '/api/og/certificate' && request.method === 'GET') {
      if (!await rateLimit(`cert-image:${ip()}`, 120, 600)) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
      const cert = await publicCertificate(url.searchParams.get('id') ?? '');
      const format = url.searchParams.get('format');
      return cert ? await certificateImage(cert, appOrigin(), format === 'square' || format === 'story' ? format : 'wide') : json({ error: 'No certificate with this id.' }, 404);
    }
    if (path === '/api/certificate' && request.method === 'GET') {
      if (!await rateLimit(`cert-check:${ip()}`, 60, 600)) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
      const cert = await publicCertificate(url.searchParams.get('id') ?? '');
      return cert ? json({ certificate: cert }) : json({ error: 'No certificate with this id.' }, 404);
    }
    if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin' }, 403);
    if (path === '/api/track' && request.method === 'POST') {
      const event = trackable((await request.json().catch(() => null))?.event);
      if (!event) return json({ error: 'Unknown event' }, 400);
      if (await rateLimit(`track:${ip()}`, 60, 600)) await count(event);
      return json({ ok: true });
    }
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
      if (!bookGift(user.email) && !(await accessFor(user.userId)).active) return json({ error: 'An active membership is required to read the book.' }, 402);
      if (!servesBook(user.email)) return json({ error: 'The book is included for SSST students. Open your own copy of the book on this device instead.' }, 403);
      return await memberBook(request);
    }
    if (path === '/api/session' && request.method === 'GET') {
      const access = await accessFor(user.userId);
      if (access.active && access.role !== 'admin') await countOnce('paid', user.userId);
      // Whether the book is served to this account now (named accounts get it without a plan).
      const book = bookGift(user.email) || (access.active && servesBook(user.email));
      return json({ user: { name: user.name, email: user.email }, access, billingReady: readiness().billing, book });
    }
    if (path === '/api/access' && request.method === 'GET') {
      const access = await accessFor(user.userId);
      return json(access, access.active ? 200 : 402);
    }
    if (path === '/api/activity' && request.method === 'POST') {
      if (!await rateLimit(`activity:${user.userId}`, 60, 3600)) return json({ error: 'Too many updates.' }, 429);
      const r = await recordActivity(user, await request.json().catch(() => null));
      return r.ok ? json(r) : json({ error: r.error }, 400);
    }
    if (path === '/api/email/prefs' && (request.method === 'GET' || request.method === 'POST')) {
      const body = request.method === 'POST' ? await request.json().catch(() => null) : undefined;
      // The case of the week is for members, so is its email.
      if ((body as { weekly?: unknown } | undefined)?.weekly === true && !(await accessFor(user.userId)).active) return json({ error: 'The case of the week is for members.' }, 402);
      const r = await emailPrefs(user, body);
      return r.ok ? json(r) : json({ error: r.error }, 400);
    }
    if (path === '/api/certificates') {
      if (request.method === 'GET') return json({ certificates: await myCertificates(user) });
      if (request.method === 'POST') {
        if (!(await accessFor(user.userId)).active) return json({ error: 'Certificates are part of membership.' }, 402);
        if (!await rateLimit(`cert:${user.userId}`, 20, 3600)) return json({ error: 'Please wait a moment before trying again.' }, 429);
        const r = await claimCertificate(user, await request.json().catch(() => null));
        return r.ok ? json(r) : json({ error: r.error }, 400);
      }
    }
    if (path === '/api/admin/stats' && request.method === 'GET') {
      if (!(await isAdmin(user.userId))) return json({ error: 'Not allowed' }, 403);
      return json(await adminStats());
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
      const created = await checkout(user.userId, body.data.tier, body.data.promoCode, body.data.affiliateCode);
      await count('checkout');
      return json(created);
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    // Never log OAuth codes, cookies, API response bodies, or personal details.
    console.error('Account request failed', { path, kind: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'We could not verify your account or payment. Please try again shortly. You have not been given access yet.' }, 503);
  }
}
