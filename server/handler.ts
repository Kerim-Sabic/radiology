import { z } from 'zod';
import { accessFor, checkout, referralProfile } from './billing.js';
import { PromoUnavailableError } from './checkoutError.js';
import { affiliateCode } from '../shared/referrals.js';
import { beginSignIn, cookie, createSession, finishSignIn, FLOW_COOKIE, hash, random, session, SESSION_COOKIE } from './auth.js';
import { clerkIdentity } from './clerk.js';
import { bookGift, memberBook, servesBook } from './book.js';
import { appOrigin, readiness } from './config.js';
import { db, rateLimit } from './store.js';
import { adminStats, cleanSource, count, countOnce, countSource, cronAuthorized, dailyCron, emailPrefs, recordActivity, rememberSource, trackable, unsubscribe, weeklyCron } from './engage.js';
import { claimCertificate, myCertificates, publicCertificate, revokeCertificate } from './certificates.js';
import { answerQuestion, finishExam, openQuestion, startExam } from './certificateExam.js';
import { queueCertificateEmail, sendCertificateEmails } from './certificateEmail.js';
import { certificateImage, certificatePageHtml } from './certificateShare.js';
import { adminAccess } from './auth.js';
import type { Permission } from './roles.js';
import { addPerson, adminPeople, emailSignIn, removeFreeAccess, setFreeAccess, setRole } from './admin.js';
import { changePromo, createPromo, listPromos, PromoAccessError } from './promos.js';
import { addStudents, changeJoinLink, classesOf, classRoster, invitation, joinClass, leaveClass, professorFor, removeStudent, setTeacherName } from './classes.js';
import { finishLinkedInPost, linkedinReady, startLinkedInPost } from './linkedin.js';
import { studentEligible, StudentDiscountError } from './studentDiscount.js';
import { beginMerchantConnect, finishMerchantConnect, MERCHANT_COOKIE, merchantConnectPage } from './merchantConnect.js';

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
/** Promo codes live in Whop: say plainly when the Whop connection has not been given promo code access. */
async function promoRequest<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string; needsWhopAccess: true }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PromoAccessError) return { ok: false, error: e.message, needsWhopAccess: true };
    throw e;
  }
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
      if (path === '/api/cron/daily') return json({ ...await dailyCron(), certificates:await sendCertificateEmails() });
      if (path === '/api/cron/weekly') return json(await weeklyCron());
      return json({ error: 'Not found' }, 404);
    }
    // A shared certificate link: the page with its own preview tags, and the preview picture (public, for link crawlers).
    if (path === '/api/certificate-page' && request.method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const [cert, index] = await Promise.all([publicCertificate(id), fetch(new URL('/index.html', appOrigin())).then((r) => r.text())]);
      return new Response(certificatePageHtml(index, cert, appOrigin(), id), { status: cert || id === 'example' ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/og/certificate' && request.method === 'GET') {
      if (!await rateLimit(`cert-image:${ip()}`, 120, 600)) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
      const cert = await publicCertificate(url.searchParams.get('id') ?? '');
      const format = url.searchParams.get('format');
      return cert?.status==='revoked' ? json({error:'This certificate has been revoked.'},410) : cert ? await certificateImage(cert, appOrigin(), format === 'square' || format === 'story' ? format : 'wide') : json({ error: 'No certificate with this id.' }, 404);
    }
    if (path === '/api/certificate/pdf' && request.method === 'GET') {
      if (!await rateLimit(`cert-pdf:${ip()}`,30,600)) return json({error:'Please try again shortly.'},429);
      const cert=await publicCertificate(url.searchParams.get('id')??'');
      if(!cert) return json({error:'Certificate not found.'},404);
      const {certificatePdf}=await import('./certificatePdf.js');
      return new Response(Buffer.from(await certificatePdf(cert,appOrigin())),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="radiology-${cert.id}.pdf"`,'Cache-Control':'no-store'}});
    }
    // A class invitation from a join link (public: anyone with the link sees whose class it is before signing up).
    if (path === '/api/class/invite' && request.method === 'GET') {
      if (!await rateLimit(`class-invite:${ip()}`, 60, 600)) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
      const found = await invitation(url.searchParams.get('code') ?? '');
      return found ? json(found) : json({ error: 'This join link does not work any more.' }, 404);
    }
    if (path === '/api/certificate' && request.method === 'GET') {
      if (!await rateLimit(`cert-check:${ip()}`, 60, 600)) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
      const cert = await publicCertificate(url.searchParams.get('id') ?? '');
      return cert ? json({ certificate: cert }) : json({ error: 'No certificate with this id.' }, 404);
    }
    if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin' }, 403);
    if (path === '/api/merchant/connect' && ['GET', 'POST'].includes(request.method)) {
      if (url.origin !== appOrigin()) return redirect(`${appOrigin()}/api/merchant/connect`);
      if (request.method === 'GET') return merchantConnectPage();
      if (!await rateLimit(`merchant-connect:${ip()}`, 5, 600)) return json({ error: 'Please wait before retrying merchant authorization.' }, 429);
      const flow = await beginMerchantConnect();
      return redirect(flow.url, [flow.cookie]);
    }
    if (path === '/api/track' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const event = trackable(body?.event);
      if (!event) return json({ error: 'Unknown event' }, 400);
      const source = cleanSource(body?.source);
      if (await rateLimit(`track:${ip()}`, 60, 600)) {
        await count(event);
        if (source && (event === 'visit' || event === 'signup_start')) await countSource(event, source);
      }
      return json({ ok: true });
    }
    if (path === '/api/auth/session' && request.method === 'POST') {
      const ip = hash(request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown');
      if (!await rateLimit(`account-session:${ip}`, 30, 600)) return json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429);
      try {
        const source = cleanSource((await request.json().catch(() => null))?.source);
        const profile = await clerkIdentity(request);
        // A new account keeps the campaign it arrived with (for the admin page's "where sign-ups come from").
        const userId = hash(`${profile.provider}:${profile.sub}`);
        const isNew = !(await db().get(`rvm:once:signup:${userId}`));
        const response = json({ ok: true });
        response.headers.append('Set-Cookie', await createSession(profile));
        if (isNew && source) await rememberSource(userId, source);
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
      if (url.searchParams.get('state')?.startsWith('merchant.')) {
        let ok = false;
        try { await finishMerchantConnect(request); ok = true; }
        catch { console.error('Merchant promo authorization was not completed'); }
        const response = merchantConnectPage(ok);
        response.headers.append('Set-Cookie', cookie(MERCHANT_COOKIE, '', 0));
        return response;
      }
      try { return authResult(true, [await finishSignIn(request), cookie(FLOW_COOKIE, '', 0)]); }
      catch { return authResult(false, [cookie(FLOW_COOKIE, '', 0)]); }
    }
    const user = await session(request);
    // Back from LinkedIn after "Post it for me" (a page visit, so it answers with a redirect, signed in or not).
    if (path === '/api/linkedin/callback' && request.method === 'GET') return redirect(`${appOrigin()}${await finishLinkedInPost(url, user)}`);
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
      if (access.active && !access.role) await countOnce('paid', user.userId);
      // Whether the book is served to this account now (named accounts get it without a plan).
      const book = bookGift(user.email) || (access.active && servesBook(user.email));
      // What this admin may do on the admin page ("admins": manage admins, the owner's alone).
      const admin = access.role === 'admin' ? await adminAccess(user.userId) : null;
      const adminPermissions = admin ? [...admin.permissions, ...(admin.owner ? ['admins'] : [])] : undefined;
      // A professor sees "My class"; a student sees who can follow their progress, and can leave.
      // Never fails the session: without this information the app works as before.
      const [teaches, classes] = await Promise.all([professorFor(user.userId).then((r) => !!r, () => false), classesOf(user.email).catch(() => [])]);
      return json({ user: { name: user.name, email: user.email }, access, billingReady: readiness().billing, book, studentDiscountEligible: await studentEligible(user.userId), ...(adminPermissions ? { adminPermissions } : {}), ...(teaches ? { teaches } : {}), ...(classes.length ? { classes } : {}) });
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
    // Certification exams: the server picks the questions, starts each question's clock, grades each answer and scores the exam.
    if (path.startsWith('/api/certificates/exam/') && request.method === 'POST') {
      if (!(await accessFor(user.userId)).active) return json({ error: 'The exams are part of membership.' }, 402);
      if (!await rateLimit(`cert-exam:${user.userId}`, 300, 600)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const body = await request.json().catch(() => null);
      const held = async () => (await myCertificates(user)).map((c) => ({ area: c.area, level: c.level, status: c.status }));
      const r =
        path === '/api/certificates/exam/start' ? await startExam(user.userId, await held(), body)
        : path === '/api/certificates/exam/open' ? await openQuestion(user.userId, body)
        : path === '/api/certificates/exam/answer' ? await answerQuestion(user.userId, body)
        : path === '/api/certificates/exam/finish' ? await finishExam(user.userId, body)
        : null;
      if (!r) return json({ error: 'Not found' }, 404);
      return r.ok ? json(r) : json({ error: r.error }, 400);
    }
    if(path==='/api/admin/certificates/revoke' && request.method==='POST') {
      if(!(await adminAccess(user.userId))?.permissions.includes('certificates')) return json({error:'Admin accounts only.'},403);
      const r=await revokeCertificate(user.userId,await request.json());
      return json(r,r.ok?200:400);
    }
    if (path === '/api/certificates') {
      if (request.method === 'GET') return json({ certificates: await myCertificates(user), linkedin: linkedinReady() });
      if (request.method === 'POST') {
        if (!(await accessFor(user.userId)).active) return json({ error: 'Certificates are part of membership.' }, 402);
        if (!await rateLimit(`cert:${user.userId}`, 20, 3600)) return json({ error: 'Please wait a moment before trying again.' }, 429);
        const r = await claimCertificate(user, await request.json().catch(() => null));
        if(r.ok && r.emailRequested) {
          try {
            await queueCertificateEmail(r.certificate,user.email);
            await sendCertificateEmails(r.certificate.id);
          } catch { console.error('Certificate email deferred; certificate remains issued'); }
        }
        return r.ok ? json(r) : json({ error: r.error }, 400);
      }
    }
    if (path === '/api/linkedin/start' && request.method === 'POST') {
      if (!linkedinReady()) return json({ error: 'Posting to LinkedIn is not set up yet.' }, 503);
      if (!await rateLimit(`linkedin:${user.userId}`, 10, 3600)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const r = await startLinkedInPost(user, await request.json().catch(() => null));
      return r.ok ? json({ url: r.url }) : json({ error: r.error }, 400);
    }
    // A student joins with a class link or leaves a class; a professor's class page (anyone else gets "Not found").
    if (path === '/api/class/join' && request.method === 'POST') {
      if (!await rateLimit(`class-join:${user.userId}`, 20, 600)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const r = await joinClass(user.email, await request.json().catch(() => null));
      return r.ok ? json(r) : json({ error: r.error }, 400);
    }
    if (path === '/api/class/leave' && request.method === 'POST') {
      const r = await leaveClass(user.email, await request.json().catch(() => null));
      return r.ok ? json(r) : json({ error: r.error }, 400);
    }
    if (path === '/api/class' || path.startsWith('/api/class/')) {
      const professor = await professorFor(user.userId);
      if (!professor) return json({ error: 'Not found' }, 404);
      if (path === '/api/class' && request.method === 'GET') {
        await setTeacherName(professor, user.name);
        return json(await classRoster(professor));
      }
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
      if (!await rateLimit(`class:${user.userId}`, 60, 600)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const body = await request.json().catch(() => null);
      const r =
        path === '/api/class/students' ? await addStudents(professor, user.name, body)
        : path === '/api/class/students/remove' ? await removeStudent(professor, body)
        : path === '/api/class/link' ? await changeJoinLink(professor, body)
        : null;
      if (!r) return json({ error: 'Not found' }, 404);
      return r.ok ? json(r) : json({ error: r.error }, 400);
    }
    // The admin dashboard. Each part needs its own permission; managing admins is the owner's alone, and answers
    // "Not found" to everyone else, so nothing tells an admin that it exists.
    if (path.startsWith('/api/admin/') && path !== '/api/admin/certificates/revoke') {
      const admin = await adminAccess(user.userId);
      if (!admin) return json({ error: 'Admin accounts only.' }, 403);
      const may = (p: Permission) => admin.permissions.includes(p);
      const denied = () => json({ error: 'Not allowed' }, 403);
      if (path === '/api/admin/role' && !admin.owner) return json({ error: 'Not found' }, 404);
      if (request.method === 'GET') {
        if (path === '/api/admin/stats') return may('numbers') ? json(await adminStats()) : denied();
        if (path === '/api/admin/people') return may('people') ? json(await adminPeople(admin)) : denied();
        if (path === '/api/admin/promos') return may('promos') ? json(await promoRequest(listPromos)) : denied();
        return json({ error: 'Not found' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
      if (!await rateLimit(`admin:${user.userId}`, 120, 600)) return json({ error: 'Please wait a moment before trying again.' }, 429);
      const body = await request.json().catch(() => null);
      const givesFree = (body as { freeUntil?: unknown } | null)?.freeUntil !== undefined;
      const r =
        path === '/api/admin/people' ? (may('add') && (!givesFree || may('free')) ? await addPerson(user.email, body) : 'denied')
        : path === '/api/admin/free' ? (may('free') ? await setFreeAccess(user.email, body) : 'denied')
        : path === '/api/admin/free/remove' ? (may('free') ? await removeFreeAccess(body) : 'denied')
        : path === '/api/admin/email-sign-in' ? (may('add') ? await emailSignIn(body) : 'denied')
        : path === '/api/admin/role' ? await setRole(user.email, body)
        : path === '/api/admin/promos' ? (may('promos') ? await promoRequest(() => createPromo(body)) : 'denied')
        : path === '/api/admin/promos/change' ? (may('promos') ? await promoRequest(() => changePromo(body)) : 'denied')
        : null;
      if (!r) return json({ error: 'Not found' }, 404);
      if (r === 'denied') return denied();
      return r.ok ? json(r) : json({ error: r.error, ...('needsWhopAccess' in r ? { needsWhopAccess: true } : {}) }, 400);
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
      const existing = await accessFor(user.userId, true);
      if (existing.active) return json({ error: 'You already have access. Manage your plan from your account.' }, 409);
      if (existing.pendingMembership) return json({ error: 'You have an existing membership. Open billing in Whop to check its payment before purchasing again.' }, 409);
      const created = await checkout(user.userId, body.data.tier, body.data.promoCode, body.data.affiliateCode);
      await count('checkout');
      return json(created);
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    if (error instanceof StudentDiscountError || error instanceof PromoUnavailableError) return json({ error: error.message }, 400);
    // Never log OAuth codes, cookies, API response bodies, or personal details.
    console.error('Account request failed', { path, kind: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'We could not verify your account or payment. Please try again shortly. You have not been given access yet.' }, 503);
  }
}
