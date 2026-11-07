/**
 * The anonymous event log (docs/TRACKING.md). No cookies, no personal data: a random visitor id in localStorage (90
 * days), a random session id in sessionStorage, and short events batched to `/api/ev` every 5 s and on leaving the
 * page. The server adds country, device and the ad tag, and drops tests, automation, previews, admins and bots.
 * `?internal=1` once turns it off in this browser (Kerim's devices); `?internal=0` turns it back on.
 */
import type { ClientEvent, PropsOf } from '../../shared/events';
import { adSource } from './source';

type Row = [number, string, Record<string, unknown>?];
const queue: Row[] = [];
const fired = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let last = '';
let pageAt = Date.now();
let off = false;

const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('').padEnd(16, '0');
function id(store: Storage, key: string, days: number) {
  try {
    const [v, at] = (store.getItem(key) ?? '').split('.');
    if (v && (!days || Date.now() - Number(at) < days * 864e5)) return v;
    const n = rand();
    store.setItem(key, days ? `${n}.${Date.now()}` : n);
    return n;
  } catch {
    return rand();
  }
}

/** Log an event; with `once`, at most once per tab session. */
export function ev<E extends ClientEvent>(name: E, props?: PropsOf<E>, once = false) {
  if (off || (once && fired.has(name))) return;
  fired.add(name);
  last = name;
  queue.push([Date.now(), name, props]);
  if (queue.length >= 30) flush();
  else timer ??= setTimeout(flush, 5000);
}

/** Whether this event already fired in this tab session. */
export const evFired = (name: ClientEvent) => fired.has(name);

function flush(beacon = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  const body = JSON.stringify({
    v: 1,
    vid: id(localStorage, 'rvm.vid', 90),
    sid: id(sessionStorage, 'rvm.sid', 0),
    tag: adSource() ?? undefined,
    et: c?.effectiveType,
    sd: c?.saveData,
    wd: navigator.webdriver || undefined,
    ev: queue.splice(0, 30),
  });
  try {
    if (beacon && navigator.sendBeacon?.('/api/ev', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    /* fall through to fetch */
  }
  void fetch('/api/ev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
}

/** Once, at start-up: the arrival, the first interaction, errors and leaving. */
export function startEv() {
  try {
    const q = new URLSearchParams(location.search).get('internal');
    if (q === '1') localStorage.setItem('rvm.internal', '1');
    if (q === '0') localStorage.removeItem('rvm.internal');
    off = localStorage.getItem('rvm.internal') === '1';
  } catch {
    /* storage blocked: log anyway */
  }
  if (off) return;
  let ref = '';
  try {
    ref = document.referrer ? new URL(document.referrer).hostname : '';
  } catch {
    /* no referrer */
  }
  const tag = adSource() ?? '';
  ev('land', { path: location.pathname, tag, ref, et: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? '' }, true);
  if (/^email/.test(tag)) ev('email_visit', { campaign: tag.split(':')[1] ?? '' }, true);
  for (const kind of ['pointerdown', 'keydown', 'scroll'])
    addEventListener(kind, () => ev('active', { kind }, true), { once: true, passive: true, capture: true });
  let errors = 0;
  addEventListener('error', (e) => {
    if (errors++ > 4) return;
    let h = 0;
    for (const ch of String(e.message)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    ev('js_error', { h: (h >>> 0).toString(36), file: String(e.filename).split('/').pop()?.slice(0, 60) ?? '', line: e.lineno || 0 });
  });
  addEventListener('pagehide', () => {
    ev('leave', { path: location.pathname, last, secs: Math.round((Date.now() - pageAt) / 1000) });
    flush(true);
  });
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true));
}

/** A route change inside the app. */
export function evPage(path: string) {
  pageAt = Date.now();
  ev('page', { path });
}
