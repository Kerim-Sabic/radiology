/**
 * Meta ads measurement in the browser (docs/TRACKING.md). The Pixel is not loaded at all until the visitor allows it
 * (src/components/AdConsent.tsx), and then it only ever sees:
 *  - a PageView on the home page, /about and /cases, and only when the address carries nothing but campaign tags;
 *  - one Purchase per confirmed payment, with the paid value and currency, under the payment's id so Meta counts it once
 *    next to the server's copy (server/metaAds.ts).
 * It never runs on a case, an atlas, a book page or anywhere an address can hold a case, a task, a code or an answer.
 * Meta's automatic events (button clicks, form fields, history changes) are switched off.
 */
export const PIXEL_ID = '2330256791086004';
const CHOICE_KEY = 'rvm.adconsent';
const FBC_KEY = 'rvm.fbc';
const REPORTED_KEY = 'rvm.metaPurchased';
const SYNC_KEY = 'rvm.adsync';
export type AdChoice = 'yes' | 'no' | null;
export const AD_CHOICE_EVENT = 'rvm:adchoice';

/** Pages the Pixel may see. Everything else (cases, tasks, the atlas, the book, the account) is never reported. */
const PIXEL_PAGES = new Set(['/', '/about', '/cases']);
/** The only address parameters it may see: campaign tags and the return from checkout. */
const SAFE_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'src', 'checkout']);

export const pixelPageAllowed = (pathname: string, search = '') => {
  if (!PIXEL_PAGES.has(pathname.replace(/\/+$/, '') || '/')) return false;
  for (const key of new URLSearchParams(search).keys()) if (!SAFE_PARAMS.has(key)) return false;
  return true;
};

/** Only the real site reports to Meta: never localhost, a preview deployment or a test run (the event log does the same). */
export const pixelHostAllowed = (host: string) => /^(www\.)?radiology\.monster$/.test(host);

/** Pages the consent prompt stays off (a case being read, a certificate, the admin page). */
export const promptSuppressed = (pathname: string) => /^\/(read|study|certificate|verify|admin)(\/|$)/.test(pathname);

export function getAdChoice(): AdChoice {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

type Fbq = { (...args: unknown[]): void; callMethod?: (...args: unknown[]) => void; queue: unknown[]; loaded: boolean; version: string; push: Fbq; disablePushState?: boolean };
type FbWindow = Window & { fbq?: Fbq; _fbq?: Fbq };
let loaded = false;

/** The Pixel's standard loader, started once and only after consent. Automatic events are off before it starts. */
export function loadPixel() {
  if (loaded || typeof window === 'undefined' || !pixelHostAllowed(location.hostname)) return;
  loaded = true;
  const w = window as FbWindow;
  if (!w.fbq) {
    const n = ((...args: unknown[]) => { if (n.callMethod) n.callMethod(...args); else n.queue.push(args); }) as Fbq;
    w.fbq = n;
    if (!w._fbq) w._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  const fbq = w.fbq!;
  fbq.disablePushState = true;
  fbq('set', 'autoConfig', false, PIXEL_ID);
  fbq('init', PIXEL_ID);
}

function fbq(...args: unknown[]) {
  const f = (window as FbWindow).fbq;
  if (f) f(...args);
}

export function trackPageView(pathname: string, search: string) {
  if (getAdChoice() !== 'yes' || !pixelPageAllowed(pathname, search)) return;
  loadPixel();
  fbq('track', 'PageView');
}

const reported = (): string[] => {
  try { return JSON.parse(localStorage.getItem(REPORTED_KEY) ?? '[]') as string[]; } catch { return []; }
};

/** The confirmed payment, once per payment id on this browser and only on a page the Pixel may see. */
export function reportPurchase(p: { id: string; value: number; currency: string }): boolean {
  if (getAdChoice() !== 'yes' || reported().includes(p.id)) return false;
  if (!pixelPageAllowed(location.pathname, location.search)) return false;
  loadPixel();
  fbq('track', 'Purchase', { value: p.value, currency: p.currency }, { eventID: p.id });
  try { localStorage.setItem(REPORTED_KEY, JSON.stringify([...reported(), p.id].slice(-10))); } catch { /* private mode */ }
  return true;
}

const cookie = (name: string) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';

/** Meta's click id from an ad link, kept in this browser for the payment's server copy. Only after consent. */
export function rememberClickId() {
  if (getAdChoice() !== 'yes') return;
  const id = new URLSearchParams(location.search).get('fbclid');
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) return;
  try { localStorage.setItem(FBC_KEY, `fb.1.${Date.now()}.${id}`); } catch { /* private mode */ }
}

/** Tell the server the choice (and, after a yes, Meta's browser and click ids) once signed in. Nothing happens signed out. */
export async function syncAdConsent(email?: string) {
  const choice = getAdChoice();
  if (!choice) return;
  const ads = choice === 'yes';
  let fbp = '';
  let fbc = '';
  if (ads) {
    fbp = cookie('_fbp');
    try { fbc = cookie('_fbc') || localStorage.getItem(FBC_KEY) || ''; } catch { fbc = cookie('_fbc'); }
  }
  const signature = `${email ?? ''}|${choice}|${fbp}|${fbc}`;
  try {
    if (sessionStorage.getItem(SYNC_KEY) === signature) return;
    const r = await fetch('/api/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ads, ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) }) });
    if (r.ok) sessionStorage.setItem(SYNC_KEY, signature);
  } catch { /* offline: tried again next time */ }
}

export function setAdChoice(choice: 'yes' | 'no') {
  try { localStorage.setItem(CHOICE_KEY, choice); } catch { /* private mode: the choice lasts until the page closes */ }
  if (choice === 'no') {
    fbq('consent', 'revoke');
    for (const name of ['_fbp', '_fbc']) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    try { localStorage.removeItem(FBC_KEY); } catch { /* ignore */ }
  } else rememberClickId();
  window.dispatchEvent(new Event(AD_CHOICE_EVENT));
}
