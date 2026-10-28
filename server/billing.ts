import { WhopClient, type Whop } from '@whop/sdk';
import { appOrigin, plans, readiness, required, type Tier } from './config.js';
import { db } from './store.js';
import { hash, isAdmin, random } from './auth.js';
import { merchantToken } from './oauth.js';

export async function whop() {
  return new WhopClient({ token: await merchantToken(), apiVersionDate: '2026-10-15-1', timeoutInSeconds: 15, maxRetries: 1 });
}
export interface Access { active: boolean; role?: 'admin'; tier?: Tier; expiresAt?: string | null; manageUrl?: string | null; pendingMembership?: boolean; }

export function membershipAccess(m: Pick<Whop.Membership, 'account' | 'plan_id' | 'status' | 'current_period_end' | 'expires_at' | 'manage_url'>, now = Date.now()): Access {
  if (m.account.id !== required('WHOP_ACCOUNT_ID')) return { active: false };
  const tier = (Object.keys(plans) as Tier[]).find(t => m.plan_id === required(plans[t].env));
  if (!tier || !['active', 'completed'].includes(m.status)) return { active: false };
  if (tier === 'monthly' && (m.status !== 'active' || !m.current_period_end || Date.parse(m.current_period_end) <= now)) return { active: false };
  if (m.expires_at && (!Number.isFinite(Date.parse(m.expires_at)) || Date.parse(m.expires_at) <= now)) return { active: false };
  if (tier === 'monthly' && !Number.isFinite(Date.parse(m.current_period_end!))) return { active: false };
  return { active: true, tier, expiresAt: tier === 'monthly' ? m.current_period_end : m.expires_at, manageUrl: safeWhopUrl(m.manage_url) };
}
export function safeWhopUrl(value?: string | null): string | null {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'whop.com' || u.hostname.endsWith('.whop.com')) ? u.href : null; } catch { return null; }
}
export function validatePlan(plan: Whop.Variant, tier: Tier) {
  if (plan.account?.id !== required('WHOP_ACCOUNT_ID') || plan.currency !== 'usd' || plan.trial_period_days || plan.expiration_days || plan.split_pay_required_payments) throw new Error('Unexpected Whop plan configuration');
  const valid = tier === 'monthly'
    ? plan.plan_type === 'renewal' && plan.billing_period === 30 && plan.initial_price === 0 && plan.renewal_price === 10
    : plan.plan_type === 'one_time' && plan.initial_price === 100 && plan.renewal_price === 0;
  if (!valid || plan.adaptive_pricing_enabled) throw new Error('Whop pricing does not match the advertised offer');
}

export async function accessFor(userId: string, fresh = false): Promise<Access> {
  // Only server-recorded, verified identities can match the private admin allowlist.
  // Admin access is not cached, so removing an allowlist entry takes effect immediately.
  if (await isAdmin(userId)) return { active: true, role: 'admin', expiresAt: null };
  if (!readiness().billing) return { active: false };
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
    plan_ids: [required('WHOP_MONTHLY_PLAN_ID'), required('WHOP_LIFETIME_PLAN_ID')], first: 100 });
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

export async function checkout(userId: string, tier: Tier) {
  const existing = await accessFor(userId, true);
  if (existing.active) throw new Error('You already have access. Manage your existing plan in your account.');
  if (existing.pendingMembership) throw new Error('An existing membership needs attention. Check your payment in Whop before purchasing again.');
  const planId = required(plans[tier].env);
  const client = await whop();
  validatePlan(await client.variants.retrieve({ id: planId }), tier);
  const key = `rvm:checkout:${userId}:${planId}:${hash(appOrigin())}`;
  // Keep the same idempotency key across retries, including ambiguous network failures.
  await db().set(key, random(), { nx: true, ex: 86400 });
  const orderId = (await db().get<string>(key))!;
  const config = await client.checkoutConfigurations.create({
    account_id: required('WHOP_ACCOUNT_ID'), plan_id: planId, mode: 'payment',
    metadata: { rvm_user: userId, rvm_order: orderId },
    redirect_url: `${appOrigin()}/?checkout=returned`,
  }, { idempotencyKey: orderId });
  const url = safeWhopUrl(config.purchase_url);
  if (!url) throw new Error('Whop did not return a checkout URL');
  if (!/^ch_[A-Za-z0-9]+$/.test(config.id)) throw new Error('Whop did not return an embedded checkout configuration');
  return { id: config.id, url, returnUrl: `${appOrigin()}/?checkout=returned` };
}

export function paymentGrantsAccess(payment: Pick<Whop.Payment, 'status' | 'substatus'>) {
  return payment.status === 'paid' && ['succeeded', 'partially_refunded', 'dispute_won', 'dispute_warning_closed', 'resolution_won'].includes(payment.substatus);
}
