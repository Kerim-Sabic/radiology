/**
 * The little the server hears about study: the days you studied (for streak reminders, if you ask for them), your
 * email choices, certificates, and anonymous funnel counts. Answers and marks stay in this browser.
 */
import { track as vercelTrack } from '@vercel/analytics/react';
import { dayKey } from './activity';

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

export type FunnelEvent = 'visit' | 'signup_start' | 'plans';

/** Count a step of the sign-up funnel (cookieless: Vercel Web Analytics plus the app's own daily counter). */
export function trackFunnel(event: FunnelEvent, once = false) {
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
  void fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }), keepalive: true }).catch(() => undefined);
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
