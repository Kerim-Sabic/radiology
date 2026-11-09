/**
 * Meta ads measurement: one Purchase per confirmed payment, and nothing else about the person.
 *
 * - A Purchase is recorded only when Whop's own record shows a payment that is `paid` and `succeeded` (billing.ts reads it
 *   server-side; a pricing view, a checkout click, a sign-up, free access or a failed or cancelled payment never gets here).
 * - It carries the paid amount (`total`, after any code) and the payment's ISO currency.
 * - The payment's id is the event id and a once-only key, so reading the same payment again (a refresh, a second session
 *   check, a replayed notification) never makes a second Purchase. The browser Pixel copy and the server copy share that id,
 *   so Meta counts them once.
 * - It is sent only for a visitor who allowed ad measurement (src/components/AdConsent.tsx) and only while the payment is
 *   recent, so old or test payments are never backfilled.
 * - Never sent: case ids, answers, scans, diagnoses, names, page addresses beyond the home page. The email is a SHA-256 hash.
 * - The Conversions API token (META_CAPI_TOKEN) lives only in the server's environment.
 */
import { createHash } from 'node:crypto';
import { appOrigin } from './config.js';
import { logServerEvent } from './events.js';
import { db } from './store.js';

/** The dataset's Pixel id (public: it is in every page that loads the Pixel). */
export const PIXEL_ID = process.env.META_PIXEL_ID || '2330256791086004';
const GRAPH = 'https://graph.facebook.com/v21.0';
/** A payment older than this is never reported (no backfill of old or test payments). */
export const PURCHASE_MAX_AGE_MS = 72 * 3_600_000;

export interface AdConsent { ads: boolean; fbp?: string; fbc?: string; at: number }
export interface BrowserPurchase { id: string; value: number; currency: string }
/** The parts of a Whop payment this reads. */
export interface PaymentLike {
  id: string;
  status: string;
  substatus: string;
  paid_at?: string | null;
  currency?: string | null;
  /** Whop's SDK gives the amount as money (`{ amount: "281.40", currency: "inr" }`); a plain number is read too. */
  total?: { amount: string; currency?: string | null } | number | null;
}

const FBP = /^fb\.[0-2]\.\d{10,14}\.\d{1,12}$/;
const FBC = /^fb\.[0-2]\.\d{10,14}\.[A-Za-z0-9_-]{1,200}$/;
export const consentKey = (userId: string) => `rvm:meta:${userId}`;
export const purchaseOnceKey = (paymentId: string) => `rvm:once:metapurchase:${paymentId}`;
export const browserPurchaseKey = (userId: string) => `rvm:meta:purchase:${userId}`;

const sha256 = (value: string) => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

/** The consent a browser reports: a yes or no, and Meta's own browser and click ids when it said yes. Null when malformed. */
export function cleanConsent(body: unknown, now = Date.now()): AdConsent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.ads !== 'boolean') return null;
  if (!b.ads) return { ads: false, at: now };
  const fbp = typeof b.fbp === 'string' && FBP.test(b.fbp) ? b.fbp : undefined;
  const fbc = typeof b.fbc === 'string' && FBC.test(b.fbc) ? b.fbc : undefined;
  return { ads: true, ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}), at: now };
}

export async function saveConsent(userId: string, body: unknown): Promise<boolean> {
  const consent = cleanConsent(body);
  if (!consent) return false;
  await db().set(consentKey(userId), consent, { ex: 400 * 86_400 });
  return true;
}

/** A paid, succeeded payment with a positive amount and a currency, made recently. */
export function eligiblePayment(payment: PaymentLike, now = Date.now()): { value: number; currency: string; paidAt: number } | null {
  if (payment.status !== 'paid' || payment.substatus !== 'succeeded') return null;
  const t = payment.total;
  const total = typeof t === 'number' ? t : t ? Number(t.amount) : NaN;
  const currency = ((t && typeof t === 'object' ? t.currency : null) ?? payment.currency ?? '').toUpperCase();
  const paidAt = payment.paid_at ? Date.parse(payment.paid_at) : NaN;
  if (!Number.isFinite(total) || !(total > 0) || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(paidAt)) return null;
  if (now - paidAt > PURCHASE_MAX_AGE_MS || paidAt > now + 3_600_000) return null;
  return { value: Math.round(total * 100) / 100, currency, paidAt };
}

/** The Conversions API event: the payment id as event id, the paid value, hashed identifiers, and the home page as the source. */
export function purchaseEvent(args: { paymentId: string; value: number; currency: string; paidAt: number; email?: string; userId: string; planId?: string; consent: AdConsent }) {
  const { consent } = args;
  return {
    event_name: 'Purchase',
    event_time: Math.floor(args.paidAt / 1000),
    event_id: args.paymentId,
    action_source: 'website',
    event_source_url: `${appOrigin()}/`,
    user_data: {
      ...(args.email ? { em: [sha256(args.email)] } : {}),
      external_id: [sha256(args.userId)],
      ...(consent.fbp ? { fbp: consent.fbp } : {}),
      ...(consent.fbc ? { fbc: consent.fbc } : {}),
    },
    custom_data: {
      value: args.value,
      currency: args.currency,
      content_type: 'product',
      ...(args.planId ? { content_ids: [args.planId] } : {}),
    },
  };
}

async function sendToMeta(event: ReturnType<typeof purchaseEvent>): Promise<boolean> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return false;
  const testCode = process.env.META_TEST_EVENT_CODE;
  try {
    const response = await fetch(`${GRAPH}/${PIXEL_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], access_token: token, ...(testCode ? { test_event_code: testCode } : {}) }),
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Called when a payment is confirmed for an account. Never throws and never blocks the access check for long: a failure
 * only means no Purchase, and the payment's once-only key keeps a retry from double counting.
 */
export async function recordPurchase(userId: string, payment: PaymentLike, planId?: string, now = Date.now()): Promise<void> {
  try {
    const paid = eligiblePayment(payment, now);
    if (!paid) return;
    // Without the visitor's yes there is nothing to send, and the payment is not looked at again.
    if ((await db().set(purchaseOnceKey(payment.id), 1, { nx: true, ex: 30 * 86_400 })) !== 'OK') return;
    const test = !!process.env.META_TEST_EVENT_CODE;
    const consent = await db().get<AdConsent>(consentKey(userId));
    if (!consent?.ads) {
      await logServerEvent('purchase', userId, { value: paid.value, currency: paid.currency, capi: false, browser: false, why: 'no_consent', test });
      return;
    }
    // The browser's copy (same event id), picked up once by the signed-in page that is on a page the Pixel may see.
    await db().set(browserPurchaseKey(userId), { id: payment.id, value: paid.value, currency: paid.currency } satisfies BrowserPurchase, { ex: 3 * 86_400 });
    const identity = await db().get<{ email: string; emailVerified: boolean }>(`rvm:identity:${userId}`);
    const event = purchaseEvent({ paymentId: payment.id, value: paid.value, currency: paid.currency, paidAt: paid.paidAt, email: identity?.emailVerified ? identity.email : undefined, userId, planId, consent });
    const capi = await sendToMeta(event);
    await logServerEvent('purchase', userId, { value: paid.value, currency: paid.currency, capi, browser: true, why: capi ? 'sent' : process.env.META_CAPI_TOKEN ? 'capi_failed' : 'no_token', test });
  } catch {
    /* measurement never gets in the way of access */
  }
}

/** The pending browser Purchase for an account, if any (left in place: the page reports each id once). */
export async function pendingBrowserPurchase(userId: string): Promise<BrowserPurchase | null> {
  try {
    return (await db().get<BrowserPurchase>(browserPurchaseKey(userId))) ?? null;
  } catch {
    return null;
  }
}
