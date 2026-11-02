import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import { appOrigin, required } from './config.js';
import { rateLimit } from './store.js';
import { mailboxKey } from './mailbox.js';

/** Accounts made for someone else (by an admin or a professor), and the emails that tell them how to sign in. */

export const clerk = () => createClerkClient({ secretKey: required('CLERK_SECRET_KEY') });
export const clerkError = (e: unknown) => (isClerkAPIResponseError(e) && e.errors[0] ? e.errors[0].longMessage || e.errors[0].message : 'Clerk could not create this account. Please try again.');

/** The Clerk account for an email: found, or created without a password (this instance signs in with an emailed code). */
export async function ensureAccount(email: string, name?: string) {
  const found = await clerk().users.getUserList({ emailAddress: [email], limit: 1 });
  if (found.data.length) return { ok: true as const, created: false, firstName: found.data[0].firstName ?? undefined };
  const [firstName, ...rest] = (name ?? '').split(/\s+/).filter(Boolean);
  try {
    await clerk().users.createUser({ emailAddress: [email], ...(firstName ? { firstName } : {}), ...(rest.length ? { lastName: rest.join(' ') } : {}), skipPasswordRequirement: true });
    return { ok: true as const, created: true, firstName };
  } catch (e) {
    return { ok: false as const, error: clerkError(e) };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const longDate = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const SIGN_IN_STEPS = 'To sign in, open radiology.monster, choose Sign in and enter this email address. We email you a code; there is no password.';

/** An account email: a title, its lines and the sign-in button, with why it was sent. */
export function accountMail(subject: string, lines: string[], why: string) {
  const signIn = `${appOrigin()}/?account=login`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#1d1d1f">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="margin:0 0 24px;font-weight:700;font-size:15px">radiology<span style="color:#4f46e5">.monster</span></p>
<div style="background:#fff;border-radius:18px;padding:28px 26px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;letter-spacing:-0.01em">${esc(subject)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#424245">${esc(l)}</p>`).join('')}
<p style="margin:22px 0 4px"><a href="${esc(signIn)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:12px">Sign in to radiology.monster</a></p>
</div>
<p style="margin:18px 6px 0;font-size:12px;line-height:1.5;color:#86868b">${esc(why)}</p>
</div></body></html>`;
  return { subject, html, text: `${subject}\n\n${lines.join('\n\n')}\n\nSign in: ${signIn}\n\n${why}` };
}

/** Send one account email through Resend (at most three an hour to one mailbox). */
export async function sendAccountMail(email: string, mail: { subject: string; html: string; text: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !(await rateLimit(`welcome:${mailboxKey(email)}`, 3, 3600))) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], ...mail }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error('Welcome email failed', { status: r.status });
    return r.ok;
  } catch {
    console.error('Welcome email failed');
    return false;
  }
}
