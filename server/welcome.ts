import { waitUntil } from '@vercel/functions';
import { appOrigin, plans, required, welcomeCodePlanIds } from './config.js';
import { regionalOffer, regionOf, welcomeAmount, type RegionalOffer } from './regional.js';
import { db } from './store.js';
import { accessFor, whop } from './billing.js';
import { studentEligible } from './studentDiscount.js';
import { offersStopped, unsubscribeUrl } from './engage.js';
import { mailFrom } from './mailbox.js';
import { everyone } from './admin.js';
import { STUDENT_PRICES } from '../shared/studentDiscount.js';
import { OFFER_DELAY_HOURS, WELCOME_HOURS, WELCOME_PERCENT, WELCOME_PREFIX, welcomeCodeKey, welcomeKey, type WelcomeRecord } from './welcomeCode.js';

/**
 * Two emails for every new account, from "Radiology Monster":
 *
 * 1. The welcome, a few seconds after the first sign-in: the free chest X-ray to read first. No code and no offer.
 * 2. The welcome gift, one day after sign-up (OFFER_DELAY_HOURS): a personal code for 40% off the first payment. The code
 *    is made when this email goes out and works for 72 hours from then. It goes only to an account that still has no
 *    access (a fresh check with Whop) and has not stopped offer emails. Until it has gone out, the app shows no offer.
 *
 * One reminder goes out in the code's last day if it is still unused. The welcome cron (/api/cron/welcome, every 10
 * minutes) sends whatever is due, so the gift goes out 24 hours after sign-up give or take ten minutes. One code per
 * account, never made again and never extended. Nothing here ever fails or slows a sign-in.
 */

const QUEUE = 'rvm:welcome-queue';
/** Accounts whose welcome-gift email is waiting for its time (the record's offerDueAt). */
const DUE = 'rvm:welcome-offer-due';
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

/**
 * The offer's prices: the standard ones, or (`regional`) the price for the country the account signed up from while
 * regional prices are on there. The code takes the same 40% off either.
 */
export function offerPrices(regional?: RegionalOffer | null) {
  if (!regional) {
    const yearly = plans.yearly.price;
    const monthly = plans.monthly.price;
    return {
      yearly: { label: 'Yearly', text: `${money(off(yearly))} for your first year instead of ${money(yearly)}. That is ${money(off(yearly) / 12)} a month.` },
      monthly: { label: 'Monthly', text: `${money(off(monthly))} for your first month instead of ${money(monthly)}.` },
      after: 'Renewals are at the standard price, and you can cancel future renewals at any time.',
    };
  }
  const { yearly, monthly, countryName } = regional;
  return regional.monthly.pass
    ? {
        yearly: { label: '1-year pass', text: `${money(welcomeAmount(yearly.price))} instead of ${money(yearly.price)}.` },
        monthly: { label: '30-day pass', text: `${money(welcomeAmount(monthly.price))} instead of ${money(monthly.price)}.` },
        after: `These are the prices for ${countryName}: pay with a card issued there. A pass is one payment and never renews.`,
      }
    : {
        yearly: { label: 'Yearly', text: `${money(welcomeAmount(yearly.price))} for your first year instead of ${money(yearly.price)}. That is ${money(welcomeAmount(yearly.price) / 12)} a month.` },
        monthly: { label: 'Monthly', text: `${money(welcomeAmount(monthly.price))} for your first month instead of ${money(monthly.price)}.` },
        after: `These are the prices for ${countryName}: pay with a card issued there. Renewals are at those prices (${money(monthly.price)} a month or ${money(yearly.price)} a year), and you can cancel future renewals at any time.`,
      };
}

/**
 * For a verified student: the student price, which takes 30% off every payment without the code, at the standard price
 * or (while student prices are on there) at the price for the account's country. Empty for anyone else.
 */
export function studentNote(student: boolean, regional?: RegionalOffer | null): string {
  if (!student) return '';
  if (!regional) return `Your university email also gets 30% off every renewal without the code ($${STUDENT_PRICES.monthly} a month or $${STUDENT_PRICES.yearly} a year): choose whichever suits you.`;
  if (!regional.student) return '';
  const { monthly, yearly } = regional.student;
  return regional.monthly.pass
    ? `Your university email also gets 30% off every pass without the code (${money(monthly)} for 30 days or ${money(yearly)} for a year): choose whichever suits you.`
    : `Your university email also gets 30% off every payment without the code (${money(monthly)} a month or ${money(yearly)} a year): choose whichever suits you.`;
}

function offerBox(code: string, expiresAt: string, student: boolean, firstLine: string, regional?: RegionalOffer | null, campaign = 'welcome') {
  const prices = offerPrices(regional);
  const note = studentNote(student, regional);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;border:2px dashed #2563eb;border-radius:16px;background:#f5f8ff"><tr><td style="padding:22px 22px 18px">
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb">${esc(firstLine)}</p>
<p style="margin:0 0 14px;font-size:24px;line-height:1.25;font-weight:800;color:#111827">${WELCOME_PERCENT}% off your first payment</p>
<p style="margin:0 0 16px"><span style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;font:700 19px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.06em">${esc(code.toUpperCase())}</span></p>
<p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#3a3a3c"><b>${esc(prices.yearly.label)}:</b> ${esc(prices.yearly.text)}</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3a3a3c"><b>${esc(prices.monthly.label)}:</b> ${esc(prices.monthly.text)}</p>
${button(`Claim my ${WELCOME_PERCENT}% off`, claimUrl(code, campaign))}
<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#6e6e73">Ends ${esc(deadline(expiresAt))}. One use, made only for your account; it is already filled in when you open the plans. ${esc(prices.after)}${note ? ` ${esc(note)}` : ''}</p>
</td></tr></table>`;
}

const claimUrl = (code: string, campaign = 'welcome') => `${appOrigin()}/?plans&promo=${encodeURIComponent(code)}&utm_source=email&utm_campaign=${campaign}`;
const caseUrl = (campaign = 'welcome') => `${appOrigin()}/read/${FIRST_CASE}?task=${encodeURIComponent(`${FIRST_CASE}:locate`)}&mode=practice&utm_source=email&utm_campaign=${campaign}`;

const MEMBERSHIP = `<ul style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:1.7;color:#3a3a3c">
<li>600+ real patients across CT, MRI, X-ray, mammography and ultrasound</li>
<li>A new case every Monday, with the expert outline and the book page</li>
<li>Drills that bring back what you missed, on a different patient</li>
<li>On-call shifts against the clock, and certificate exams</li>
</ul>`;

function footer(unsubscribe: string, when = 'just') {
  return `You are getting this because you ${when ? `${when} ` : ''}created an account at radiology.monster. <a href="${esc(unsubscribe)}" style="color:#86868b">Stop offer emails</a>.<br>Chest X-ray: NIH ChestX-ray14, NIH Clinical Center. For education only, not for clinical diagnosis.`;
}

/**
 * The welcome. A new account's has no offer (its code comes a day later, in offerMail); an account made before the
 * welcome email existed gets its code in it. `opts.regional`: the price for the account's country while regional prices
 * are on there (else the standard price).
 */
export function welcomeMail(userId: string, r: WelcomeRecord, opts: { student: boolean; replies: boolean; regional?: RegionalOffer | null }): WelcomeMail {
  const prices = offerPrices(opts.regional);
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
${offer ? `${p('And because you are new here, a welcome gift that is only yours:')}${offerBox(offer.code, offer.expiresAt, opts.student, 'Your welcome gift', opts.regional)}` : ''}
${p('<b>A membership opens everything:</b>', 'margin-bottom:8px')}
${MEMBERSHIP}
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
          `${prices.yearly.label}: ${prices.yearly.text} ${prices.monthly.label}: ${prices.monthly.text}`,
          `Claim it: ${claimUrl(offer.code)}`,
          `Ends ${deadline(offer.expiresAt)}. One use, only for your account. ${prices.after}${studentNote(opts.student, opts.regional) ? ` ${studentNote(opts.student, opts.regional)}` : ''}`,
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
  return { to: r.email, subject, html: shell(preheader, body, footer(unsubscribe, r.earlier ? '' : 'just')), text: lines.join('\n'), unsubscribe };
}

/** The welcome gift, a day after sign-up: the personal code, what it takes off, and how long it works. */
export function offerMail(userId: string, r: WelcomeRecord, opts: { student: boolean; replies: boolean; regional?: RegionalOffer | null }): WelcomeMail {
  const prices = offerPrices(opts.regional);
  const name = firstName(r.name);
  const unsubscribe = unsubscribeUrl(userId, 'offers');
  const code = r.code!;
  const ends = r.expiresAt!;
  const note = studentNote(opts.student, opts.regional);
  const subject = `${name ? `${name}, a` : 'A'} welcome gift: ${WELCOME_PERCENT}% off your first payment`;
  const preheader = `A personal code for ${WELCOME_PERCENT}% off your first payment, for the next ${WELCOME_HOURS} hours.`;
  const body = `
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;letter-spacing:-0.02em;color:#111827">${esc(name ? `${name}, a welcome gift.` : 'A welcome gift for you.')}</h1>
${p(`You joined Radiology Monster yesterday. To welcome you, here is ${WELCOME_PERCENT}% off your first payment, with a code made only for your account. It works for the next ${WELCOME_HOURS} hours.`)}
${offerBox(code, ends, opts.student, 'Your welcome gift', opts.regional, 'welcome_gift')}
${p('<b>A membership opens everything:</b>', 'margin-bottom:8px')}
${MEMBERSHIP}
${p(`Not read your free case yet? Start with the chest X-ray and see how the grading feels: <a href="${esc(caseUrl('welcome_gift'))}" style="color:#2563eb">open your first case</a>.`)}
${p(opts.replies ? 'Questions about the plans? Just reply to this email. We read every one.' : 'See you in the reading room,')}
${p('<b>Radiology Monster</b>', 'margin-bottom:0')}`;
  const text = [
    name ? `${name}, a welcome gift.` : 'A welcome gift for you.',
    '',
    `You joined Radiology Monster yesterday. To welcome you, here is ${WELCOME_PERCENT}% off your first payment, with a code made only for your account. It works for the next ${WELCOME_HOURS} hours.`,
    '',
    `Your code: ${code.toUpperCase()}`,
    `${prices.yearly.label}: ${prices.yearly.text} ${prices.monthly.label}: ${prices.monthly.text}`,
    `Claim it: ${claimUrl(code, 'welcome_gift')}`,
    `Ends ${deadline(ends)}. One use, only for your account. ${prices.after}${note ? ` ${note}` : ''}`,
    '',
    `Not read your free case yet? Start here: ${caseUrl('welcome_gift')}`,
    '',
    opts.replies ? 'Questions about the plans? Just reply to this email. We read every one.' : 'See you in the reading room,',
    'Radiology Monster',
    '',
    `Stop offer emails: ${unsubscribe}`,
  ].join('\n');
  return { to: r.email, subject, html: shell(preheader, body, footer(unsubscribe, 'recently')), text, unsubscribe };
}

export function reminderMail(userId: string, r: WelcomeRecord, now = Date.now(), regional?: RegionalOffer | null): WelcomeMail {
  const prices = offerPrices(regional);
  const name = firstName(r.name);
  const unsubscribe = unsubscribeUrl(userId, 'offers');
  const code = r.code!;
  const hours = Math.max(1, Math.floor((Date.parse(r.expiresAt!) - now) / HOUR));
  const left = hours === 1 ? 'an hour' : `${hours} hours`;
  const subject = `${name ? `${name}, your` : 'Your'} ${WELCOME_PERCENT}% off ends in ${left}`;
  const body = `
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;letter-spacing:-0.02em;color:#111827">${esc(`Your welcome gift ends in ${left}.`)}</h1>
${p(`${name ? `${esc(name)}, a` : 'A'} quick reminder before it goes: your personal code still takes ${WELCOME_PERCENT}% off your first payment, and after ${esc(deadline(r.expiresAt!))} it stops working.`)}
${offerBox(code, r.expiresAt!, false, 'Still yours, for now', regional)}
${p(`Not sure yet? Read the free chest X-ray first and see how the grading feels: <a href="${esc(caseUrl())}" style="color:#2563eb">open your first case</a>.`)}
${p('Radiology Monster', 'margin-bottom:0')}`;
  const text = [
    `Your welcome gift ends in ${left}.`,
    '',
    `Your code ${code.toUpperCase()} takes ${WELCOME_PERCENT}% off your first payment until ${deadline(r.expiresAt!)}.`,
    `${prices.yearly.label}: ${prices.yearly.text} ${prices.monthly.label}: ${prices.monthly.text}`,
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

/**
 * Whether a welcome code may include India's rupee UPI passes. The code is a percentage, so the currency shouldn't matter,
 * but Whop hasn't been seen to take a dollar-based code on a rupee plan yet. If it refuses, the same code is made on the
 * card plans alone and later codes skip the UPI passes (an Indian buyer with such a code pays by card, or by UPI without
 * it). Reset with each cold start; exported for the tests.
 */
export const welcomeCodeUpi = { on: true };

/**
 * Make the personal code in Whop: both plans and the regional plans (checkout puts it on a regional plan only for a
 * visitor who gets that price; Whop's card rules cover the discounted amounts), the first payment only, one use, 72 hours.
 */
async function makeCode(userId: string, r: WelcomeRecord, now: number): Promise<{ code: string; promoId: string; expiresAt: string }> {
  const client = await whop();
  const expiresAt = new Date(now + WELCOME_HOURS * HOUR).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = welcomeCode(r.name);
    // Codes are unique per business: if the same code is refused with the UPI passes and taken without them, they were the
    // reason. If both are refused, the code itself is taken and the next attempt tries a new one.
    for (const upi of welcomeCodeUpi.on ? [true, false] : [false]) try {
      const created = await client.promoCodes.create(
        {
          account_id: required('WHOP_ACCOUNT_ID'),
          product_id: required('WHOP_PRODUCT_ID'),
          plan_ids: [required(plans.monthly.env), required(plans.yearly.env), ...welcomeCodePlanIds(upi)],
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
        { idempotencyKey: `welcome-${userId}-${attempt}${upi ? '' : '-card'}` },
      );
      if (!upi && welcomeCodeUpi.on) {
        welcomeCodeUpi.on = false;
        console.warn('Whop refused the UPI passes in a welcome code: welcome codes are made on the card plans only');
      }
      return { code, promoId: created.id, expiresAt };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // A refused code (taken by another account) gets a new random tail; anything else is not retried here.
      if (status !== 400 && status !== 409 && status !== 422) throw e;
    }
  }
  throw new Error('No free welcome code');
}

const KEEP = { ex: 30 * 86_400 };
const save = (userId: string, r: WelcomeRecord) => db().set(welcomeKey(userId), r, KEEP);

/**
 * Whether the account already has what the offer sells: a paying member, one whose membership waits on a payment or a
 * billing update, an admin, a professor or free access from an admin or a class. A fresh check with Whop (not the
 * 30-second cache); null when Whop cannot answer (nothing is sent then; the cron tries again).
 */
async function hasAccess(userId: string): Promise<boolean | null> {
  try {
    const access = await accessFor(userId, true);
    return access.active || !!access.pendingMembership || !!(await db().get(`rvm:once:paid:${userId}`));
  } catch {
    return null;
  }
}

/**
 * Make the account's one code, now (its 72 hours start now). No promo permission in Whop (it will not come back by
 * itself) means no offer; other errors wait for the cron, which gives up on the offer a day after it was due.
 */
async function issueCode(userId: string, r: WelcomeRecord, now: number): Promise<WelcomeRecord | 'later'> {
  try {
    const made = await makeCode(userId, r, now);
    await db().set(welcomeCodeKey(made.code), userId, KEEP);
    return { ...r, ...made };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    const due = Date.parse(r.offerDueAt ?? r.joinedAt);
    if (status === 401 || status === 403 || now - due > 24 * HOUR) return { ...r, noOffer: true };
    return 'later';
  }
}

/**
 * The account's first sign-in: remember it, send the welcome in the background (never awaited by the sign-in), and
 * set the welcome gift for 24 hours later. `country`: Vercel's IP country of the first sign-in, kept only when it has a
 * regional price.
 */
export async function welcomeNewAccount(user: { userId: string; email: string; name: string }, country?: string | null, now = Date.now()) {
  if (process.env.WELCOME_EMAIL === 'off' || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  try {
    const code = country?.trim().toUpperCase();
    const record: WelcomeRecord = {
      email: user.email, name: user.name, joinedAt: new Date(now).toISOString(),
      offerDueAt: new Date(now + OFFER_DELAY_HOURS * HOUR).toISOString(),
      ...(code && regionOf(code) ? { country: code } : {}),
    };
    if ((await db().set(welcomeKey(user.userId), record, { nx: true, ...KEEP })) !== 'OK') return;
    await db().sadd(QUEUE, user.userId);
    await db().sadd(DUE, user.userId);
    waitUntil(sendWelcome(user.userId).catch(() => undefined));
  } catch {
    /* the welcome cron sends anything left in the queue */
  }
}

/**
 * Send one account's welcome. A new account's has no offer (the gift follows a day later, from sendWelcomeOffer); an
 * account made before the welcome email existed gets its code with it. Safe to call twice: it sends once.
 */
export async function sendWelcome(userId: string, now = Date.now()): Promise<'sent' | 'later' | 'done'> {
  if (!(await db().set(`rvm:welcome-lock:${userId}`, '1', { nx: true, ex: 120 }))) return 'later';
  try {
    let r = await db().get<WelcomeRecord>(welcomeKey(userId));
    if (!r || r.sentAt) {
      await db().srem(QUEUE, userId);
      return 'done';
    }
    // Members, admins, professors and class invitees with free access have what these emails are for (and an
    // admin-made account already got its own welcome from server/admin.ts): no welcome and no gift for them.
    const member = await hasAccess(userId);
    if (member === null) return 'later';
    if (member) {
      await save(userId, { ...r, noOffer: true, sentAt: 'skipped: has access' });
      await db().srem(QUEUE, userId);
      await db().srem(DUE, userId);
      return 'done';
    }
    if (r.earlier && !r.code && !r.noOffer) {
      // An account made before the welcome email: it signed up long ago, so its code comes with the welcome.
      const issued = await issueCode(userId, r, now);
      if (issued === 'later') {
        await save(userId, r);
        return 'later';
      }
      r = issued;
      await save(userId, r);
    } else if (!r.earlier && !r.offerDueAt && !r.code && !r.noOffer) {
      // Queued before the gift waited a day (2026-11-06): its gift is due a day after its sign-up.
      r = { ...r, offerDueAt: new Date(Date.parse(r.joinedAt) + OFFER_DELAY_HOURS * HOUR).toISOString() };
      await save(userId, r);
      await db().sadd(DUE, userId);
    }
    const student = await studentEligible(userId).catch(() => false);
    const regional = await regionalOffer(r.country);
    const ok = await send(welcomeMail(userId, r, { student, replies: !!process.env.EMAIL_REPLY_TO, regional }), `welcome-${userId}`);
    if (!ok) return 'later';
    const at = new Date(now).toISOString();
    await save(userId, { ...r, sentAt: at, ...(r.code ? { offerSentAt: at } : {}) });
    await db().srem(QUEUE, userId);
    if (r.code) await db().sadd(OPEN, userId);
    return 'sent';
  } finally {
    await db().del(`rvm:welcome-lock:${userId}`);
  }
}

/**
 * The welcome gift, once it is due (24 hours after sign-up): the code is made now, so its 72 hours start with this
 * email. Skipped for an account that has access by then, that stopped offer emails, or whose welcome never went out.
 * Safe to call twice: it sends once and never makes a second code (a send that failed is retried with the same code).
 */
export async function sendWelcomeOffer(userId: string, now = Date.now()): Promise<'sent' | 'later' | 'done'> {
  if (!(await db().set(`rvm:welcome-lock:${userId}`, '1', { nx: true, ex: 120 }))) return 'later';
  try {
    let r = await db().get<WelcomeRecord>(welcomeKey(userId));
    const finished = async (record?: WelcomeRecord) => {
      if (record) await save(userId, record);
      await db().srem(DUE, userId);
      return 'done' as const;
    };
    if (!r || r.offerSentAt || r.noOffer || !r.offerDueAt) return await finished();
    if (Date.parse(r.offerDueAt) > now) return 'later';
    // The welcome goes first; if it is still waiting on Whop or Resend, so does the gift.
    if (!r.sentAt) return 'later';
    // A code made for a send that kept failing is not announced in its last day: the reminder's moment has passed too.
    if (r.code && r.expiresAt && Date.parse(r.expiresAt) - now < 24 * HOUR) return await finished({ ...r, noOffer: true });
    if (await offersStopped(userId)) return await finished({ ...r, noOffer: true });
    const member = await hasAccess(userId);
    if (member === null) return 'later';
    if (member) return await finished({ ...r, noOffer: true });
    if (!r.code) {
      const issued = await issueCode(userId, r, now);
      if (issued === 'later') return 'later';
      if (issued.noOffer) return await finished(issued);
      r = issued;
      await save(userId, r);
    }
    const student = await studentEligible(userId).catch(() => false);
    const regional = await regionalOffer(r.country);
    const ok = await send(offerMail(userId, r, { student, replies: !!process.env.EMAIL_REPLY_TO, regional }), `welcome-gift-${userId}`);
    if (!ok) return 'later';
    await save(userId, { ...r, offerSentAt: new Date(now).toISOString() });
    await db().srem(DUE, userId);
    await db().sadd(OPEN, userId);
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

/**
 * Every 10 minutes (/api/cron/welcome): welcomes still waiting, gifts that are due, then one reminder to each account
 * whose unused code ends within the next day.
 */
export async function welcomeCron(now = Date.now()) {
  let welcomed = 0;
  let offered = 0;
  let reminded = 0;
  for (const userId of ((await db().smembers(QUEUE)) as string[]).slice(0, 25)) if ((await sendWelcome(userId, now)) === 'sent') welcomed++;
  const waiting = (await db().smembers(DUE)) as string[];
  if (waiting.length) {
    const records = (await db().mget<Array<WelcomeRecord | null>>(...waiting.map(welcomeKey))) as Array<WelcomeRecord | null>;
    const due = waiting.filter((_, i) => !records[i]?.offerDueAt || Date.parse(records[i]!.offerDueAt!) <= now);
    for (const userId of due.slice(0, 25)) if ((await sendWelcomeOffer(userId, now)) === 'sent') offered++;
  }
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
    if (await send(reminderMail(userId, r, now, await regionalOffer(r.country)), `welcome-reminder-${userId}`)) {
      await save(userId, { ...r, reminderAt: new Date(now).toISOString() });
      await db().srem(OPEN, userId);
      reminded++;
    }
  }
  return { welcomed, offered, reminded };
}

// ---------------------------------------------------------------- accounts made before the welcome email existed
/**
 * Accounts that signed up before the welcome email and never had it: an account with no plan, no admin or professor
 * role and no free access, no welcome yet, and offer emails not stopped. Refuses when Whop cannot say who pays, so a
 * paying member is never offered a discount by mistake (and sendWelcome checks each one with Whop again).
 */
export async function earlierAccounts(now = Date.now()) {
  const all = await everyone(now);
  if (all.whop !== 'ok') return { ok: false as const, error: 'Whop did not answer, so paying members cannot be told apart. Nothing was sent; try again shortly.' };
  const withAccount = all.people.filter((p) => p.account && p.userId);
  const candidates = withAccount.filter((p) => p.access === 'none');
  const ids = candidates.map((p) => p.userId!);
  const records = ids.length ? ((await db().mget<Array<WelcomeRecord | null>>(...ids.map(welcomeKey))) as Array<WelcomeRecord | null>) : [];
  const marks = ids.length ? ((await db().mget<unknown[]>(...ids.flatMap((id) => [`rvm:no-offers:${id}`, `rvm:once:paid:${id}`]))) as unknown[]) : [];
  const stopped = (i: number) => !!marks[i * 2];
  const paidBefore = (i: number) => !!marks[i * 2 + 1];
  const waiting = candidates.filter((_, i) => !records[i] && !stopped(i) && !paidBefore(i));
  return {
    ok: true as const,
    waiting: waiting.map((p) => ({ userId: p.userId!, email: p.email, name: p.name })),
    counts: {
      waiting: waiting.length,
      welcomed: records.filter(Boolean).length,
      stopped: candidates.filter((_, i) => stopped(i)).length,
      members: withAccount.length - candidates.length + candidates.filter((_, i) => paidBefore(i)).length,
    },
  };
}

/** Send the welcome (with its 72-hour code) to the next earlier accounts; the admin page calls this until none are left. */
export async function welcomeEarlierAccounts(limit = 15, now = Date.now()) {
  const found = await earlierAccounts(now);
  if (!found.ok) return found;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of found.waiting.slice(0, limit)) {
    const record: WelcomeRecord = { email: p.email, name: p.name || p.email, joinedAt: new Date(now).toISOString(), earlier: true };
    if ((await db().set(welcomeKey(p.userId), record, { nx: true, ex: 30 * 86_400 })) !== 'OK') continue;
    await db().sadd(QUEUE, p.userId);
    const r = await sendWelcome(p.userId, Date.now()).catch(() => 'later' as const);
    if (r === 'sent') sent++;
    else if (r === 'done') skipped++;
    else failed++;
    // Resend accepts about two emails a second.
    if (r === 'sent') await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { ok: true as const, sent, skipped, failed, left: Math.max(0, found.waiting.length - Math.min(limit, found.waiting.length)) };
}
