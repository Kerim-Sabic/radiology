/**
 * Small messages to the server: the days you studied (for streak reminders, if you ask for them), your email
 * choices, and anonymous funnel counts. Submitted answers are saved to the account by services/progressSync.ts.
 */
import { track as vercelTrack } from '@vercel/analytics/react';
import { dayKey } from './activity';
import { adSource } from './source';

const SENT_KEY = 'rvm.activity.sent';

/** Tell the server you studied today (once a day per browser; failures are retried on the next answer). */
export function pingStudied(now = new Date()) {
  const day = dayKey(now);
  try {
    if (localStorage.getItem(SENT_KEY) === day) return;
  } catch {
    /* storage unavailable: send anyway */
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  void fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, tz }) })
    .then((r) => {
      if (r.ok)
        try {
          localStorage.setItem(SENT_KEY, day);
        } catch {
          /* ignore */
        }
    })
    .catch(() => undefined);
}

/**
 * `guest_open` / `guest_mark` / `guest_answer` / `guest_second`: a sample patient opened, marked, answered, and a second
 * task opened without an account (from an ad or a link). `code_sent`: the sign-up form sent its email code.
 * `checkout_ready` / `checkout_error`: the payment form appeared, or failed to load.
 */
export type FunnelEvent =
  | 'visit'
  | 'guest_open'
  | 'guest_mark'
  | 'guest_answer'
  | 'guest_second'
  | 'signup_start'
  | 'code_sent'
  | 'plans'
  | 'checkout_ready'
  | 'checkout_error';

/** Sent when a guest's answer is graded: the account form, the next step offered, starts loading in the background. */
export const WARM_ACCOUNT_EVENT = 'rvm:warm-account';

/**
 * Count a step of the sign-up funnel (cookieless: Vercel Web Analytics plus the app's own daily counter). `seconds` goes
 * with `guest_mark`: how long the visitor looked before marking. Nothing about the person is sent.
 */
export function trackFunnel(event: FunnelEvent, once = false, seconds?: number) {
  if (once) {
    try {
      const k = `rvm.track.${event}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, '1');
    } catch {
      /* ignore */
    }
  }
  try {
    vercelTrack(event);
  } catch {
    /* analytics is optional */
  }
  const source = adSource();
  const body = { event, ...(source ? { source } : {}), ...(seconds !== undefined && Number.isFinite(seconds) ? { seconds: Math.round(seconds) } : {}) };
  void fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
}

/** A case's images are on screen: the funnel step between the sign-up and the first answer (once per account on the server). */
export function trackOpened() {
  try {
    if (sessionStorage.getItem('rvm.track.opened')) return;
    sessionStorage.setItem('rvm.track.opened', '1');
  } catch {
    /* storage unavailable: send anyway */
  }
  try {
    vercelTrack('opened');
  } catch {
    /* analytics is optional */
  }
  void fetch('/api/track/opened', { method: 'POST', keepalive: true }).catch(() => undefined);
}

export interface EmailPrefs {
  streak: boolean;
  weekly: boolean;
}

export async function getEmailPrefs(): Promise<EmailPrefs | null> {
  try {
    const r = await fetch('/api/email/prefs', { cache: 'no-store' });
    if (!r.ok) return null;
    return ((await r.json()) as { prefs: EmailPrefs }).prefs;
  } catch {
    return null;
  }
}

export async function setEmailPrefs(p: Partial<EmailPrefs>): Promise<EmailPrefs | null> {
  try {
    const r = await fetch('/api/email/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    if (!r.ok) return null;
    return ((await r.json()) as { prefs: EmailPrefs }).prefs;
  } catch {
    return null;
  }
}
