import { WhopClient, type Whop } from '@whop/sdk';
import { appOrigin, plans, readiness, regionalPlan, regionalPlans, required, membershipPlans, type AccessTier, type Tier } from './config.js';
import { regionalOffer, regionalPlanProblems, studentAmount } from './regional.js';
import { db } from './store.js';
import { hash, isAdmin, random } from './auth.js';
import { merchantToken } from './oauth.js';
import { grantActive, grantFor } from './grants.js';
import { professorRole } from './roles.js';
import { affiliateCode } from '../shared/referrals.js';
import { checkoutDiscount } from './studentDiscount.js';
import { PromoUnavailableError } from './checkoutError.js';
import { WELCOME_PREFIX } from './welcomeCode.js';

export async function whop() {
  return new WhopClient({ token: await merchantToken(), apiVersionDate: '2026-10-15-1', timeoutInSeconds: 15, maxRetries: 1 });
}

/** Resolve only the signed-in, verified identity. Search results alone are not identity proof. */
export async function referralProfile(userId: string) {
  const identity = await db().get<{ email: string; emailVerified: boolean }>(`rvm:identity:${userId}`);
  if (identity?.emailVerified !== true) return { shareUrl: null };
  const client = await whop();
  const candidates = await client.members.list({ account_id: required('WHOP_ACCOUNT_ID'), query: identity.email, first: 100 });
  const matches = new Map<string, string | undefined>();
  for await (const member of candidates) {
    if (member.account_id === required('WHOP_ACCOUNT_ID') && member.email?.trim().toLowerCase() === identity.email.trim().toLowerCase() && member.user?.id) {
      const code = affiliateCode(member.user.username);
      matches.set(member.user.id, code);
    }
  }
  if (matches.size > 1) throw new Error('Ambiguous referral identity');
  const code = [...matches.values()][0];
  // This is the business's native Whop external-link asset. It records clicks,
  // then redirects to radiology.monster with the affiliate's public username.
  return { shareUrl: code ? `https://whop.com/e/trk_zpdZ5h59TRkTrN/${encodeURIComponent(code)}` : null, code };
}
/** `role`: an admin, free access an admin or a class gave, or a professor (none is a payment). */
export interface Access { active: boolean; role?: 'admin' | 'granted' | 'professor'; tier?: AccessTier; expiresAt?: string | null; manageUrl?: string | null; pendingMembership?: boolean; }

/** When a one-time regional pass ends (Whop sets expires_at; current_period_end as a fallback), or null. */
function passEnd(m: Pick<Whop.Membership, 'current_period_end' | 'expires_at'>): number | null {
  const end = Date.parse(m.expires_at || m.current_period_end || '');
  return Number.isFinite(end) ? end : null;
}

export function membershipAccess(m: Pick<Whop.Membership, 'account' | 'plan_id' | 'status' | 'current_period_end' | 'expires_at' | 'manage_url'>, now = Date.now()): Access {
  if (m.account.id !== required('WHOP_ACCOUNT_ID')) return { active: false };
  const entry = membershipPlans().find(plan => plan.id === m.plan_id);
  const tier = entry?.tier;
  if (!tier || !['active', 'completed'].includes(m.status)) return { active: false };
  // A pass is paid once and opens access until it ends: never without an end date.
  if (entry.pass) {
    const end = passEnd(m);
    return end !== null && end > now ? { active: true, tier, expiresAt: new Date(end).toISOString(), manageUrl: safeWhopUrl(m.manage_url) } : { active: false };
  }
  if (tier !== 'lifetime' && (m.status !== 'active' || !m.current_period_end || Date.parse(m.current_period_end) <= now)) return { active: false };
  if (m.expires_at && (!Number.isFinite(Date.parse(m.expires_at)) || Date.parse(m.expires_at) <= now)) return { active: false };
  if (tier !== 'lifetime' && !Number.isFinite(Date.parse(m.current_period_end!))) return { active: false };
  return { active: true, tier, expiresAt: tier !== 'lifetime' ? m.current_period_end : m.expires_at, manageUrl: safeWhopUrl(m.manage_url) };
}
export function safeWhopUrl(value?: string | null): string | null {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'whop.com' || u.hostname.endsWith('.whop.com')) ? u.href : null; } catch { return null; }
}
export function validatePlan(plan: Whop.Variant, tier: Tier) {
  validateRecurringPlan(plan, plans[tier]);
}
function validateRecurringPlan(plan: Whop.Variant, offer: { days: number; price: number }) {
  if (plan.account?.id !== required('WHOP_ACCOUNT_ID') || plan.currency !== 'usd' || plan.trial_period_days || plan.expiration_days || plan.split_pay_required_payments) throw new Error('Unexpected Whop plan configuration');
  const valid = plan.plan_type === 'renewal' && plan.billing_period === offer.days && plan.initial_price === 0 && plan.renewal_price === offer.price;
  // Whop's adaptive-pricing flag applies only to one-time payments. These
  // allowlisted renewal plans always bill in their original USD currency.
  if (!valid) throw new Error('Whop pricing does not match the advertised offer');
}

export async function accessFor(userId: string, fresh = false): Promise<Access> {
  // Only server-recorded, verified identities can match the private admin allowlist.
  // Admin access is not cached, so removing an allowlist entry takes effect immediately.
  if (await isAdmin(userId)) return { active: true, role: 'admin', expiresAt: null };
  // Free access an admin gave is not cached either. A paid plan still wins, so its member keeps the billing link,
  // and a Whop outage does not lock out someone who has free access.
  const granted = await grantedAccess(userId);
  if (!readiness().billing) return granted ?? { active: false };
  try {
    const paid = await paidAccess(userId, fresh);
    return paid.active || !granted ? paid : granted;
  } catch (error) {
    if (granted) return granted;
    throw error;
  }
}

async function grantedAccess(userId: string): Promise<Access | null> {
  const identity = await db().get<{ email: string; emailVerified: boolean }>(`rvm:identity:${userId}`);
  if (identity?.emailVerified !== true) return null;
  if (await professorRole(identity.email)) return { active: true, role: 'professor', expiresAt: null };
  const grant = await grantFor(identity.email);
  return grant && grantActive(grant) ? { active: true, role: 'granted', expiresAt: grant.until } : null;
}

/** The site account a membership was bought from: Whop copies the checkout's metadata (`rvm_user`, set in checkout below) onto it. */
export function membershipOwner(m: Pick<Whop.Membership, 'metadata'>): string | undefined {
  const owner = m.metadata?.rvm_user;
  return typeof owner === 'string' && owner ? owner : undefined;
}
/** The memberships bought from a site account (ids), and the plans it started a checkout for (plan id → when it first did). */
const ownedKey = (userId: string) => `rvm:owned:${userId}`;
const startedKey = (userId: string) => `rvm:checkout-started:${userId}`;
const OWNERS_READ = 'rvm:owners-read';

async function addOwned(userId: string, ids: string[]) {
  const have = (await db().get<string[]>(ownedKey(userId))) ?? [];
  const next = [...new Set([...have, ...ids])];
  if (next.length > have.length) await db().set(ownedKey(userId), next);
}

/** Every 6 hours, read which account each membership was bought from. This picks up purchases made before checkouts were
 * recorded (2026-11-05), and any a scan below missed. */
async function readOwners(client: WhopClient) {
  if (!(await db().set(OWNERS_READ, Date.now(), { nx: true, ex: 6 * 3600 }))) return;
  try {
    const byOwner = new Map<string, string[]>();
    const list = await client.memberships.list({ account_id: required('WHOP_ACCOUNT_ID'), product_ids: [required('WHOP_PRODUCT_ID')], plan_ids: membershipPlans().map(p => p.id), first: 100 });
    for await (const m of list) {
      const owner = membershipOwner(m);
      if (owner) byOwner.set(owner, [...(byOwner.get(owner) ?? []), m.id]);
    }
    for (const [owner, ids] of byOwner) await addOwned(owner, ids);
  } catch (error) {
    await db().del(OWNERS_READ);
    console.error('Whop membership owners could not be read', error);
  }
}

/** Memberships bought through this site's checkout from this account, whatever email the Whop customer has. Right after a
 * checkout, the memberships made since are read until one of them is this account's. */
async function ownedMemberships(client: WhopClient, userId: string): Promise<Whop.Membership[]> {
  const started = await db().get<Record<string, string>>(startedKey(userId));
  const plans = Object.keys(started ?? {});
  if (plans.length && (await db().set(`rvm:owned-scan:${userId}`, 1, { nx: true, ex: 10 }))) {
    const since = Math.min(...Object.values(started!).map(t => Date.parse(t))) - 10 * 60_000;
    const list = await client.memberships.list({ account_id: required('WHOP_ACCOUNT_ID'), plan_ids: plans, created_after: new Date(since).toISOString(), first: 100 });
    const mine: string[] = [];
    for await (const m of list) if (membershipOwner(m) === userId) mine.push(m.id);
    if (mine.length) {
      await addOwned(userId, mine);
      await db().del(startedKey(userId));
    }
  }
  await readOwners(client);
  const ids = (await db().get<string[]>(ownedKey(userId))) ?? [];
  const found = await Promise.all(ids.map(id => client.memberships.retrieve({ id }).catch((error: unknown) => {
    if ((error as { statusCode?: number } | null)?.statusCode === 404) return null;
    throw error;
  })));
  return found.filter((m): m is Whop.Membership => !!m && membershipOwner(m) === userId);
}

/** The Whop customer this account signed in with, or the one whose email is this account's verified email. */
async function linkedWhopUser(client: WhopClient, userId: string): Promise<string | null> {
  const linked = await db().get<string>(`rvm:whop-user:${userId}`);
  if (linked) return linked;
  const identity = await db().get<{ email: string; emailVerified: boolean; provider?: string }>(`rvm:identity:${userId}`);
  if (identity?.emailVerified !== true || identity.provider !== 'clerk') return null;
  // This lookup requires member:email:read. A name/username search match never grants access.
  const candidates = await client.members.list({ account_id: required('WHOP_ACCOUNT_ID'), query: identity.email, first: 100 });
  const exact = [];
  for await (const member of candidates) {
    if (member.account_id === required('WHOP_ACCOUNT_ID') && member.email?.trim().toLowerCase() === identity.email.trim().toLowerCase() && member.user?.id) exact.push(member.user.id);
  }
  const matched = [...new Set(exact)];
  if (matched.length > 1) throw new Error('Ambiguous payment identity');
  if (!matched[0]) return null;
  await db().set(`rvm:whop-user:${userId}`, matched[0]);
  return matched[0];
}

async function paidAccess(userId: string, fresh: boolean): Promise<Access> {
  if (!fresh) {
    const cached = await db().get<Access>(`rvm:access:${userId}`);
    if (cached && (!cached.expiresAt || Date.parse(cached.expiresAt) > Date.now())) return cached;
  }
  const client = await whop();
  // A purchase belongs to the account that started its checkout, even when the Whop customer's email is another one.
  const candidates = new Map<string, Whop.Membership>();
  for (const m of await ownedMemberships(client, userId)) candidates.set(m.id, m);
  const whopUser = await linkedWhopUser(client, userId);
  if (whopUser) {
    const memberships = await client.memberships.list({ account_id: required('WHOP_ACCOUNT_ID'), user_id: whopUser,
      plan_ids: membershipPlans().map(plan => plan.id), first: 100 });
    for await (const m of memberships) {
      // Not one bought from another account here: one payment opens one account.
      const owner = membershipOwner(m);
      if (m.user_id === whopUser && (!owner || owner === userId)) candidates.set(m.id, m);
    }
  }
  let result: Access = { active: false };
  for (const m of candidates.values()) {
    if (m.product_id !== required('WHOP_PRODUCT_ID') || m.account.id !== required('WHOP_ACCOUNT_ID')) continue;
    if (!membershipPlans().some(plan => plan.id === m.plan_id)) continue;
    // A one-time pass that has ended is not waiting on anything, so it never blocks buying again.
    const endedPass = !!regionalPlan(m.plan_id)?.pass && !((passEnd(m) ?? 0) > Date.now());
    if (!result.active && !endedPass && ['active', 'past_due', 'trialing'].includes(m.status)) {
      result = { active: false, pendingMembership: true, manageUrl: safeWhopUrl(m.manage_url) };
    }
    const access = membershipAccess(m);
    if (!access.active) continue;
    // Read the latest successful charge too: refunded/disputed purchases must not unlock access
    // even if a membership lifecycle notification is late. No browser parameter grants access.
    const payments = await client.payments.list({ account_id: required('WHOP_ACCOUNT_ID'), membership_id: m.id,
      status: 'paid', order: 'created_at', direction: 'desc', first: 1 });
    const payment = payments.data[0];
    if (!payment || !paymentGrantsAccess(payment)) continue;
    if (result.tier !== 'lifetime') result = access;
  }
  await db().set(`rvm:access:${userId}`, result, { ex: 30 });
  return result;
}

/** `country`: Vercel's IP country of the request, which picks a regional price (server/regional.ts) when one applies. */
export async function checkout(userId: string, tier: Tier, promoCode?: string, referralCode?: string, country?: string | null) {
  const existing = await accessFor(userId, true);
  if (existing.active) throw new Error('You already have access. Manage your existing plan in your account.');
  if (existing.pendingMembership) throw new Error('An existing membership needs attention. Check your payment in Whop before purchasing again.');
  const promo = promoCode?.trim().toLowerCase();
  const client = await whop();
  // The price for the visitor's country goes with no code, or with a welcome code (40% off the first payment; Whop's card
  // rules cover that amount too, and checkoutDiscount below makes sure the code is the buyer's own). Any other code goes
  // with the standard price: codes are never put on the regional plans, except the buyer's own welcome code and a verified
  // student's own 30% code (below). A welcome code made before 2026-11-05 is on the standard plans only, so it also falls
  // back to them. The server picks the plan; the browser cannot.
  const welcomeCode = promo?.startsWith(WELCOME_PREFIX) ? promo : undefined;
  let regional = promo && !welcomeCode ? null : await regionalOffer(country);
  let regionalChoice = regional ? regionalPlans[regional.region][tier] : null;
  if (regionalChoice && welcomeCode && !(await promoLiveFor(client, regionalChoice.id, welcomeCode))) {
    regional = null;
    regionalChoice = null;
  }
  // New purchases, including promotions, always use the current plan.
  // Whop remains authoritative for availability, the final quote, and atomic redemption.
  const planId = regionalChoice?.id ?? required(plans[tier].env);
  // Monthly passes an entered code on to Whop; yearly takes only a live code made for the yearly plan (from the admin page).
  // (A welcome code on a regional plan was just checked above.)
  if (promo && tier === 'yearly' && !regionalChoice && !(await promoLiveFor(client, planId, promo))) throw new PromoUnavailableError('This code is not available for the yearly plan. Check the code, or choose monthly.');
  const plan = await client.variants.retrieve({ id: planId });
  if (regionalChoice) {
    if (regionalPlanProblems(plan, regionalChoice).length) throw new Error('Unexpected Whop plan configuration');
  } else validatePlan(plan, tier);
  // On a regional plan: a welcome code goes through checkoutDiscount for its owner check (and wins over the student price:
  // discounts never stack). With no code, a verified student gets their own 30% code on the regional plan, every payment,
  // once an admin has turned student prices on there (each student amount needs its Whop card rule first).
  const discount = regionalChoice && !welcomeCode
    ? (regional?.student ? await checkoutDiscount(client, userId, tier, planId) : {})
    : await checkoutDiscount(client, userId, tier, planId, promo);
  let affiliate = affiliateCode(referralCode);
  if (affiliate && (await referralProfile(userId)).code === affiliate) affiliate = undefined;
  const key = `rvm:checkout:${userId}:${planId}:${hash(appOrigin())}${affiliate ? `:${hash(affiliate)}` : ''}`;
  // Keep the same idempotency key across retries, including ambiguous network failures.
  await db().set(key, random(), { nx: true, ex: 86400 });
  const orderId = (await db().get<string>(key))!;
  // So the payment is found for this account even when the buyer's Whop email is another one (ownedMemberships above).
  const started = (await db().get<Record<string, string>>(startedKey(userId))) ?? {};
  if (!started[planId]) await db().set(startedKey(userId), { ...started, [planId]: new Date().toISOString() }, { ex: 14 * 86400 });
  const config = await client.checkoutConfigurations.create({
    account_id: required('WHOP_ACCOUNT_ID'), plan_id: planId, mode: 'payment',
    ...(affiliate ? { affiliate_code: affiliate } : {}),
    metadata: { rvm_user: userId, rvm_order: orderId, ...(regional ? { rvm_region: regional.region, rvm_country: regional.country } : {}) },
    redirect_url: `${appOrigin()}/?checkout=returned`,
  }, { idempotencyKey: orderId });
  const url = safeWhopUrl(config.purchase_url);
  if (!url) throw new Error('Whop did not return a checkout URL');
  if (!/^ch_[A-Za-z0-9]+$/.test(config.id)) throw new Error('Whop did not return an embedded checkout configuration');
  return {
    id: config.id, url, ...discount, returnUrl: `${appOrigin()}/?checkout=returned`,
    ...(regional && regionalChoice ? { regional: { country: regional.country, countryName: regional.countryName, price: regionalChoice.price, days: regionalChoice.days, pass: regionalChoice.pass,
      ...('studentDiscount' in discount && discount.studentDiscount ? { studentPrice: studentAmount(regionalChoice.price) } : {}) } } : {}),
  };
}

/** Whether a code is active, unexpired and not used up on this plan in Whop. */
async function promoLiveFor(client: WhopClient, planId: string, promo: string) {
  try {
    const codes = await client.promoCodes.list({ account_id: required('WHOP_ACCOUNT_ID'), plan_ids: [planId], status: 'active', first: 100 });
    for await (const c of codes)
      if (c.code?.toLowerCase() === promo) return (!c.expires_at || Date.parse(c.expires_at) > Date.now()) && (c.unlimited_stock || c.stock > 0); // stock: uses left
  } catch {
    /* No promo code access: no yearly codes. */
  }
  return false;
}

export function paymentGrantsAccess(payment: Pick<Whop.Payment, 'status' | 'substatus'>) {
  return payment.status === 'paid' && ['succeeded', 'partially_refunded', 'dispute_won', 'dispute_warning_closed', 'resolution_won'].includes(payment.substatus);
}
