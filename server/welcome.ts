import { waitUntil } from '@vercel/functions';
import { appOrigin, plans, required } from './config.js';
import { db } from './store.js';
import { accessFor, whop } from './billing.js';
import { studentEligible } from './studentDiscount.js';
import { offersStopped, unsubscribeUrl } from './engage.js';
import { mailFrom } from './mailbox.js';
import { WELCOME_HOURS, WELCOME_PERCENT, WELCOME_PREFIX, welcomeCodeKey, welcomeKey, type WelcomeRecord } from './welcomeCode.js';

/**
 * The welcome email every new account gets a few seconds after its first sign-in, from "Radiology Monster": the free chest X-ray
 * to read first, and a personal code for 40% off the first payment that works for 72 hours. One reminder goes out in the
 * code's last day if it is still unused (from the daily cron). Nothing here ever fails or slows a sign-in.
 */

const QUEUE = 'rvm:welcome-queue';
const OPEN = 'rvm:welcome-open';
const FIRST_CASE = 'cxr-00003400-003';
const HOUR = 3_600_000;

/** Codes are personal: "welcome-ana-k7q3m". Letters only from the first name; no 0/o/1/l/i in the random part. */
export function welcomeCode(name: string, rand: () => number = Math.random): string {
  const first = (name.includes('@') ? '' : name.trim().split(/\s+/)[0] ?? '')
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase()
    .slice(0, 8);
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const tail = Array.from({ length: 5 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
  return `${WELCOME_PREFIX}${first ? `${first}-` : ''}${tail}`;
}

export function firstName(name: string): string {
  const first = name.includes('@') ? '' : (name.trim().split(/\s+/)[0] ?? '');
  return first.length > 1 && first.length <= 24 ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const off = (price: number) => Math.round(price * (100 - WELCOME_PERCENT)) / 100;
/** "Saturday 8 November, 14:20 UTC" */
export function deadline(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${day}, ${d.toISOString().slice(11, 16)} UTC`;
}

// ---------------------------------------------------------------- the emails
export interface WelcomeMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribe: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const p = (html: string, extra = '') => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3a3a3c;${extra}">${html}</p>`;
const button = (text: string, url: string, primary = true) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td style="border-radius:12px;background:${primary ? '#2563eb' : '#111827'}"><a href="${esc(url)}" style="display:inline-block;padding:14px 24px;font:600 16px ${FONT};color:#ffffff;text-decoration:none;border-radius:12px">${esc(text)} &rarr;</a></td></tr></table>`;

function shell(preheader: string, body: string, footer: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>radiology.monster</title></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:${FONT};color:#1d1d1f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 6px 18px"><a href="${esc(appOrigin())}" style="text-decoration:none;color:#1d1d1f"><img src="${esc(appOrigin())}/icon-192.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px"><span style="vertical-align:middle;font-weight:700;font-size:16px">Radiology Monster</span></a></td></tr>
<tr><td style="background:#ffffff;border-radius:20px;padding:30px 28px">${body}</td></tr>
<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:#86868b">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function offerBox(code: string, expiresAt: string, student: boolean, firstLine: string) {
  const yearly = plans.yearly.price;
  const monthly = plans.monthly.price;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;border:2px dashed #2563eb;border-radius:16px;background:#f5f8ff"><tr><td style="padding:22px 22px 18px">
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb">${esc(firstLine)}</p>
<p style="margin:0 0 14px;font-size:24px;line-height:1.25;font-weight:800;color:#111827">${WELCOME_PERCENT}% off your first payment</p>
<p style="margin:0 0 16px"><span style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;font:700 19px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.06em">${esc(code.toUpperCase())}</span></p>
<p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#3a3a3c"><b>Yearly:</b> ${money(off(yearly))} for your first year instead of ${money(yearly)}. That is ${money(off(yearly) / 12)} a month.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3a3a3c"><b>Monthly:</b> ${money(off(monthly))} for your first month instead of ${money(monthly)}.</p>
${button(`Claim my ${WELCOME_PERCENT}% off`, claimUrl(code))}
<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#6e6e73">Ends ${esc(deadline(expiresAt))}. One use, made only for your account; it is already filled in when you open the plans. Renewals are at the standard price, and you can cancel future renewals at any time.${student ? ' Your university email also gets 30% off every renewal without the code: choose whichever suits you.' : ''}</p>
</td></tr></table>`;
}

const claimUrl = (code: string) => `${appOrigin()}/?plans&promo=${encodeURIComponent(code)}&utm_source=email&utm_campaign=welcome`;
const caseUrl = () => `${appOrigin()}/read/${FIRST_CASE}?task=${encodeURIComponent(`${FIRST_CASE}:locate`)}&mode=practice&utm_source=email&utm_campaign=welcome`;

function footer(unsubscribe: string, when = 'just') {
  return `You are getting this because you ${when} created an account at radiology.monster. <a href="${esc(unsubscribe)}" style="color:#86868b">Stop offer emails</a>.<br>Chest X-ray: NIH ChestX-ray14, NIH Clinical Center. For education only, not for clinical diagnosis.`;
}

export function welcomeMail(userId: string, r: WelcomeRecord, opts: { student: boolean; replies: boolean }): WelcomeMail {
  const name = firstName(r.name);
  const unsubscribe = unsubscribeUrl(userId, 'offers');
  const offer = r.code && r.expiresAt ? { code: r.code, expiresAt: r.expiresAt } : null;
  const subject = offer
    ? `${name ? `${name}, your` : 'Your'} first scan is ready (and ${WELCOME_PERCENT}% off is yours)`
    : `${name ? `Welcome, ${name}.` : 'Welcome.'} Your first scan is ready`;
  const preheader = offer
    ? `A personal code for ${WELCOME_PERCENT}% off your first payment, for the next ${WELCOME_HOURS} hours. Start with a real chest X-ray.`
    : 'Start with a real chest X-ray, graded on the exact spot you mark.';
  const body = `
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;letter-spacing:-0.02em;color:#111827">${esc(name ? `Welcome, ${name}.` : 'Welcome.')}</h1>
${p("Radiology Monster is where you practise the way radiologists actually read: the whole study, no arrows, and a grade on the exact spot you mark.")}
${p('So here is the best way to start. It takes about five minutes.')}
<a href="${esc(caseUrl())}" style="display:block;margin:6px 0 14px;text-decoration:none"><img src="${esc(appOrigin())}/email/first-case.jpg" width="504" alt="A frontal chest X-ray from a real patient" style="display:block;width:100%;max-width:504px;height:auto;border-radius:14px;border:0"></a>
<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6e6e73">Your first case · free</p>
<p style="margin:0 0 12px;font-size:19px;line-height:1.35;font-weight:700;color:#111827">A real chest X-ray. Find the pneumothorax.</p>
${p('Box what you see, commit, and your mark is graded against the expert reference on the image. Then read why on the exact page of <i>Learning Radiology</i>.')}
${button('Read your first scan', caseUrl(), !offer)}
<div style="height:24px"></div>
${offer ? `${p('And because you are new here, a welcome gift that is only yours:')}${offerBox(offer.code, offer.expiresAt, opts.student, 'Your welcome gift')}` : ''}
${p('<b>A membership opens everything:</b>', 'margin-bottom:8px')}
<ul style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:1.7;color:#3a3a3c">
<li>600+ real patients across CT, MRI, X-ray, mammography and ultrasound</li>
<li>A new case every Monday, with the expert outline and the book page</li>
<li>Drills that bring back what you missed, on a different patient</li>
<li>On-call shifts against the clock, and certificate exams</li>
</ul>
${p(opts.replies ? 'If anything is confusing, or a case looks wrong, just reply to this email. We read every one.' : 'If a case ever looks wrong, the “Report a problem” link under every task comes straight to us.')}
${p('See you in the reading room,<br><b>Radiology Monster</b>', 'margin-bottom:0')}
${offer ? `<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e5e5ea;font-size:14px;line-height:1.55;color:#6e6e73">P.S. Read the free case first. If it is not for you, you have lost five minutes. If it is, your ${WELCOME_PERCENT}% is waiting until ${esc(deadline(offer.expiresAt))}.</p>` : ''}`;
  const lines = [
    name ? `Welcome, ${name}.` : 'Welcome.',
    '',
    'Radiology Monster is where you practise the way radiologists actually read: the whole study, no arrows, and a grade on the exact spot you mark.',
    '',
    'Start here (about five minutes): a real chest X-ray. Find the pneumothorax. Box what you see, commit, and your mark is graded against the expert reference.',
    `Read your first scan: ${caseUrl()}`,
    '',
    ...(offer
      ? [
          `Your welcome gift: ${WELCOME_PERCENT}% off your first payment with the code ${offer.code.toUpperCase()}.`,
          `Yearly: ${money(off(plans.yearly.price))} for your first year instead of ${money(plans.yearly.price)}. Monthly: ${money(off(plans.monthly.price))} for your first month instead of ${money(plans.monthly.price)}.`,
          `Claim it: ${claimUrl(offer.code)}`,
          `Ends ${deadline(offer.expiresAt)}. One use, only for your account. Renewals are at the standard price; cancel future renewals at any time.${opts.student ? ' Your university email also gets 30% off every renewal without the code.' : ''}`,
          '',
        ]
      : []),
    opts.replies ? 'If anything is confusing, just reply to this email. We read every one.' : 'If a case ever looks wrong, use “Report a problem” under the task.',
    '',
    'See you in the reading room,',
    'Radiology Monster',
    '',
    `Stop offer emails: ${unsubscribe}`,
  ];
  return { to: r.email, subject, html: shell(preheader, body, footer(unsubscribe)), text: lines.join('\n'), unsubscribe };
}

export function reminderMail(userId: string, r: WelcomeRecord, now = Date.now()): WelcomeMail {
  const name = firstName(r.name);
  const unsubscribe = unsubscribeUrl(userId, 'offers');
  const code = r.code!;
  const hours = Math.max(1, Math.floor((Date.parse(r.expiresAt!) - now) / HOUR));
  const left = hours === 1 ? 'an hour' : `${hours} hours`;
  const subject = `${name ? `${name}, your` : 'Your'} ${WELCOME_PERCENT}% off ends in ${left}`;
  const body = `
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;letter-spacing:-0.02em;color:#111827">${esc(`Your welcome gift ends in ${left}.`)}</h1>
${p(`${name ? `${esc(name)}, a` : 'A'} quick reminder before it goes: your personal code still takes ${WELCOME_PERCENT}% off your first payment, and after ${esc(deadline(r.expiresAt!))} it stops working.`)}
${offerBox(code, r.expiresAt!, false, 'Still yours, for now')}
${p(`Not sure yet? Read the free chest X-ray first and see how the grading feels: <a href="${esc(caseUrl())}" style="color:#2563eb">open your first case</a>.`)}
${p('Radiology Monster', 'margin-bottom:0')}`;
  const text = [
    `Your welcome gift ends in ${left}.`,
    '',
    `Your code ${code.toUpperCase()} takes ${WELCOME_PERCENT}% off your first payment until ${deadline(r.expiresAt!)}.`,
    `Yearly: ${money(off(plans.yearly.price))} for your first year instead of ${money(plans.yearly.price)}. Monthly: ${money(off(plans.monthly.price))} for your first month instead of ${money(plans.monthly.price)}.`,
    `Claim it: ${claimUrl(code)}`,
    '',
    `Not sure yet? Read the free chest X-ray first: ${caseUrl()}`,
    '',
    'Radiology Monster',
    '',
    `Stop offer emails: ${unsubscribe}`,
  ].join('\n');
  return { to: r.email, subject, html: shell(`Your code ${code.toUpperCase()} stops working ${deadline(r.expiresAt!)}.`, body, footer(unsubscribe, 'recently')), text, unsubscribe };
}

// ---------------------------------------------------------------- sending
async function send(mail: WelcomeMail, idempotencyKey: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = mailFrom();
  if (!key || !from) return false;
  const replyTo = process.env.EMAIL_REPLY_TO;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        from,
        to: [mail.to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { 'List-Unsubscribe': `<${mail.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) console.error('Welcome email failed', { status: r.status });
    return r.ok;
  } catch {
    return false;
  }
}

/** Make the personal code in Whop: both plans, the first payment only, one use, 72 hours. */
async function makeCode(userId: string, r: WelcomeRecord, now: number): Promise<{ code: string; promoId: string; expiresAt: string }> {
  const client = await whop();
  const expiresAt = new Date(now + WELCOME_HOURS * HOUR).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = welcomeCode(r.name);
    try {
      const created = await client.promoCodes.create(
        {
          account_id: required('WHOP_ACCOUNT_ID'),
          product_id: required('WHOP_PRODUCT_ID'),
          plan_ids: [required(plans.monthly.env), required(plans.yearly.env)],
          code,
          promo_type: 'percentage',
          amount_off: WELCOME_PERCENT,
          base_currency: 'usd',
          // Whop: the number of billing months the discount lasts; 1 is the first payment only (as "once" on the admin page).
          promo_duration_months: 1,
          new_users_only: false,
          churned_users_only: false,
          existing_memberships_only: false,
          one_per_customer: true,
          unlimited_stock: false,
          stock: 1,
          expires_at: expiresAt,
        },
        { idempotencyKey: `welcome-${userId}-${attempt}` },
      );
      return { code, promoId: created.id, expiresAt };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // A refused code (taken by another account) gets a new random tail; anything else is not retried here.
      if (status !== 400 && status !== 409 && status !== 422) throw e;
    }
  }
  throw new Error('No free welcome code');
}

/** The account's first sign-in: remember it and send the welcome in the background (never awaited by the sign-in). */
export async function welcomeNewAccount(user: { userId: string; email: string; name: string }) {
  if (process.env.WELCOME_EMAIL === 'off' || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  try {
    const record: WelcomeRecord = { email: user.email, name: user.name, joinedAt: new Date().toISOString() };
    if ((await db().set(welcomeKey(user.userId), record, { nx: true, ex: 30 * 86_400 })) !== 'OK') return;
    await db().sadd(QUEUE, user.userId);
    waitUntil(sendWelcome(user.userId).catch(() => undefined));
  } catch {
    /* the daily cron sends anything left in the queue */
  }
}

/** Send one account's welcome (with its code when it can have one). Safe to call twice: it sends once. */
export async function sendWelcome(userId: string, now = Date.now()): Promise<'sent' | 'later' | 'done'> {
  if (!(await db().set(`rvm:welcome-lock:${userId}`, '1', { nx: true, ex: 120 }))) return 'later';
  try {
    let r = await db().get<WelcomeRecord>(welcomeKey(userId));
    if (!r || r.sentAt) {
      await db().srem(QUEUE, userId);
      return 'done';
    }
    if (!r.code && !r.noOffer) {
      // Members, admins, professors and class invitees with free access have what this email sells (and an admin-made
      // account already got its own welcome from server/admin.ts): no email for them.
      const access = await accessFor(userId).catch(() => ({ active: false }));
      if (access.active) {
        await db().set(welcomeKey(userId), { ...r, noOffer: true, sentAt: 'skipped: has access' }, { ex: 30 * 86_400 });
        await db().srem(QUEUE, userId);
        return 'done';
      }
      try {
        const made = await makeCode(userId, r, now);
        r = { ...r, ...made };
        await db().set(welcomeCodeKey(made.code), userId, { ex: 30 * 86_400 });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // No promo permission in Whop (it will not come back by itself): welcome without an offer. Other errors:
        // try again from the cron, and give up on the offer after a day so the welcome never waits longer.
        if (status === 401 || status === 403 || now - Date.parse(r.joinedAt) > 24 * HOUR) r = { ...r, noOffer: true };
        else {
          await db().set(welcomeKey(userId), r, { ex: 30 * 86_400 });
          return 'later';
        }
      }
      await db().set(welcomeKey(userId), r, { ex: 30 * 86_400 });
    }
    const student = await studentEligible(userId).catch(() => false);
    const ok = await send(welcomeMail(userId, r, { student, replies: !!process.env.EMAIL_REPLY_TO }), `welcome-${userId}`);
    if (!ok) return 'later';
    await db().set(welcomeKey(userId), { ...r, sentAt: new Date(now).toISOString() }, { ex: 30 * 86_400 });
    await db().srem(QUEUE, userId);
    if (r.code) await db().sadd(OPEN, userId);
    return 'sent';
  } finally {
    await db().del(`rvm:welcome-lock:${userId}`);
  }
}

/** Whether the code has been redeemed (or the account has paid some other way). */
async function used(userId: string, r: WelcomeRecord): Promise<boolean> {
  if (await db().get(`rvm:once:paid:${userId}`)) return true;
  try {
    if ((await accessFor(userId)).active) return true;
    if (r.promoId) {
      const c = await (await whop()).promoCodes.retrieve({ id: r.promoId });
      return c.uses > 0 || c.status !== 'active';
    }
  } catch {
    return true; // unsure: do not remind
  }
  return false;
}

/** Daily: send welcomes still waiting, then one reminder to accounts whose unused code ends within the next day. */
export async function welcomeCron(now = Date.now()) {
  let welcomed = 0;
  let reminded = 0;
  for (const userId of ((await db().smembers(QUEUE)) as string[]).slice(0, 25)) if ((await sendWelcome(userId, now)) === 'sent') welcomed++;
  for (const userId of (await db().smembers(OPEN)) as string[]) {
    const r = await db().get<WelcomeRecord>(welcomeKey(userId));
    const ends = r?.expiresAt ? Date.parse(r.expiresAt) : 0;
    if (!r?.code || ends <= now || r.reminderAt) {
      await db().srem(OPEN, userId);
      continue;
    }
    if (ends - now > 24 * HOUR || ends - now < 2 * HOUR) continue;
    if ((await offersStopped(userId)) || (await used(userId, r))) {
      await db().srem(OPEN, userId);
      continue;
    }
    if (await send(reminderMail(userId, r, now), `welcome-reminder-${userId}`)) {
      await db().set(welcomeKey(userId), { ...r, reminderAt: new Date(now).toISOString() }, { ex: 30 * 86_400 });
      await db().srem(OPEN, userId);
      reminded++;
    }
  }
  return { welcomed, reminded };
}
