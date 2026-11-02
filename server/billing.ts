import { WhopClient, type Whop } from '@whop/sdk';
import { appOrigin, plans, readiness, required, membershipPlans, type AccessTier, type Tier } from './config.js';
import { db } from './store.js';
import { hash, isAdmin, random } from './auth.js';
import { merchantToken } from './oauth.js';
import { grantActive, grantFor } from './grants.js';
import { professorRole } from './roles.js';
import { affiliateCode } from '../shared/referrals.js';
import { checkoutDiscount } from './studentDiscount.js';
import { PromoUnavailableError } from './checkoutError.js';

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

export function membershipAccess(m: Pick<Whop.Membership, 'account' | 'plan_id' | 'status' | 'current_period_end' | 'expires_at' | 'manage_url'>, now = Date.now()): Access {
  if (m.account.id !== required('WHOP_ACCOUNT_ID')) return { active: false };
  const tier = membershipPlans().find(plan => plan.id === m.plan_id)?.tier;
  if (!tier || !['active', 'completed'].includes(m.status)) return { active: false };
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

async function paidAccess(userId: string, fresh: boolean): Promise<Access> {
  if (!fresh) {
    const cached = await db().get<Access>(`rvm:access:${userId}`);
    if (cached && (!cached.expiresAt || Date.parse(cached.expiresAt) > Date.now())) return cached;
  }
  const client = await whop();
  let whopUser = await db().get<string>(`rvm:whop-user:${userId}`);
  if (!whopUser) {
    const identity = await db().get<{ email: string; emailVerified: boolean; provider?: string }>(`rvm:identity:${userId}`);
    if (identity?.emailVerified !== true || identity.provider !== 'clerk') return { active: false };
    // This lookup requires member:email:read. A name/username search match never grants access.
    const candidates = await client.members.list({ account_id: required('WHOP_ACCOUNT_ID'), query: identity.email, first: 100 });
    const exact = [];
    for await (const member of candidates) {
      if (member.account_id === required('WHOP_ACCOUNT_ID') && member.email?.trim().toLowerCase() === identity.email.trim().toLowerCase() && member.user?.id) exact.push(member.user.id);
    }
    const matched = [...new Set(exact)];
    if (matched.length > 1) throw new Error('Ambiguous payment identity');
    whopUser = matched[0] || null;
    if (!whopUser) return { active: false };
    await db().set(`rvm:whop-user:${userId}`, whopUser);
  }
  const memberships = await client.memberships.list({ account_id: required('WHOP_ACCOUNT_ID'), user_id: whopUser,
    plan_ids: membershipPlans().map(plan => plan.id), first: 100 });
  let result: Access = { active: false };
  for await (const m of memberships) {
    if (m.user_id !== whopUser || m.product_id !== required('WHOP_PRODUCT_ID')) continue;
    if (m.account.id !== required('WHOP_ACCOUNT_ID')) continue;
    if (!result.active && ['active', 'past_due', 'trialing'].includes(m.status)) {
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

export async function checkout(userId: string, tier: Tier, promoCode?: string, referralCode?: string) {
  const existing = await accessFor(userId, true);
  if (existing.active) throw new Error('You already have access. Manage your existing plan in your account.');
  if (existing.pendingMembership) throw new Error('An existing membership needs attention. Check your payment in Whop before purchasing again.');
  const promo = promoCode?.trim().toLowerCase();
  // New purchases, including promotions, always use the current plan.
  // Whop remains authoritative for availability, the final quote, and atomic redemption.
  const planId = required(plans[tier].env);
  const client = await whop();
  // Monthly passes an entered code on to Whop; yearly takes only a live code made for the yearly plan (from the admin page).
  if (promo && tier === 'yearly' && !(await promoLiveFor(client, planId, promo))) throw new PromoUnavailableError('This code is not available for the yearly plan. Check the code, or choose monthly.');
  const plan = await client.variants.retrieve({ id: planId });
  validatePlan(plan, tier);
  const discount = await checkoutDiscount(client, userId, tier, planId, promo);
  let affiliate = affiliateCode(referralCode);
  if (affiliate && (await referralProfile(userId)).code === affiliate) affiliate = undefined;
  const key = `rvm:checkout:${userId}:${planId}:${hash(appOrigin())}${affiliate ? `:${hash(affiliate)}` : ''}`;
  // Keep the same idempotency key across retries, including ambiguous network failures.
  await db().set(key, random(), { nx: true, ex: 86400 });
  const orderId = (await db().get<string>(key))!;
  const config = await client.checkoutConfigurations.create({
    account_id: required('WHOP_ACCOUNT_ID'), plan_id: planId, mode: 'payment',
    ...(affiliate ? { affiliate_code: affiliate } : {}),
    metadata: { rvm_user: userId, rvm_order: orderId },
    redirect_url: `${appOrigin()}/?checkout=returned`,
  }, { idempotencyKey: orderId });
  const url = safeWhopUrl(config.purchase_url);
  if (!url) throw new Error('Whop did not return a checkout URL');
  if (!/^ch_[A-Za-z0-9]+$/.test(config.id)) throw new Error('Whop did not return an embedded checkout configuration');
  return { id: config.id, url, ...discount, returnUrl: `${appOrigin()}/?checkout=returned` };
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
