export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function appOrigin() {
  const url = new URL(required('APP_URL'));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('APP_URL must use HTTPS');
  return url.origin;
}

export function readiness() {
  const storage = !!((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
  const clerk = !!process.env.CLERK_SECRET_KEY && /^pk_(live|test)_/.test(clerkPublishableKey);
  const auth = storage && !!process.env.APP_URL && (clerk || !!process.env.WHOP_APP_ID);
  const merchant = !!process.env.WHOP_API_KEY || (process.env.WHOP_OAUTH_ENABLED === '1' && !!process.env.TOKEN_ENCRYPTION_KEY);
  const billing = auth && merchant && ['WHOP_ACCOUNT_ID', 'WHOP_PRODUCT_ID', 'WHOP_MONTHLY_PLAN_ID', 'WHOP_YEARLY_PLAN_ID'].every(k => !!process.env[k]);
  return { auth, billing, authProvider: clerk ? 'clerk' : 'whop', clerkPublishableKey: clerk ? clerkPublishableKey : undefined };
}

export const plans = {
  monthly: { title: 'Monthly', price: 20, days: 30, env: 'WHOP_MONTHLY_PLAN_ID' },
  yearly: { title: 'Yearly', price: 150, days: 365, env: 'WHOP_YEARLY_PLAN_ID' },
} as const;
export type Tier = keyof typeof plans;

export type AccessTier = Tier | 'lifetime';

/**
 * Regional prices: hidden Whop plans on the same product, for cards issued in the region's countries only (Whop payment
 * rules decline any other card; server/regional.ts checks the rules matched before giving access). B renews; C is
 * one-time passes, because recurring card charges fail in much of South Asia. Never attach a promo code to these.
 */
export type Region = 'b' | 'c';
export interface RegionalPlan { id: string; region: Region; tier: Tier; price: number; days: number; pass: boolean }
export const regionalPlans: Record<Region, Record<Tier, RegionalPlan>> = {
  b: {
    monthly: { id: 'plan_b52gijYg4Tn9M', region: 'b', tier: 'monthly', price: 9.99, days: 30, pass: false },
    yearly: { id: 'plan_nj0Tsdp38ErIP', region: 'b', tier: 'yearly', price: 74.99, days: 365, pass: false },
  },
  c: {
    monthly: { id: 'plan_OvcwelLFspRHH', region: 'c', tier: 'monthly', price: 4.99, days: 30, pass: true },
    yearly: { id: 'plan_tN0iOTyKQmVUi', region: 'c', tier: 'yearly', price: 39.99, days: 365, pass: true },
  },
};
export const allRegionalPlans = (): RegionalPlan[] => Object.values(regionalPlans).flatMap((r) => Object.values(r));

/**
 * UPI for India: the C passes again, charged in rupees, on hidden Whop plans that accept **UPI only**. No card can pay
 * them, so they need no card-country rule: a UPI payment comes from an Indian bank account, and the server offers these
 * plans only to visitors whose IP country is India. Off while an id is empty. Account 1 made both in Whop on 2026-11-07
 * (one-time, INR, hidden, payment methods: UPI only); checkout reads each one back and refuses it unless it is exactly that.
 */
export interface UpiPlan extends RegionalPlan { currency: 'inr'; rupees: number }
export const UPI_COUNTRIES = ['IN'] as const;
export const upiPlans: Record<Tier, UpiPlan> = {
  monthly: { id: 'plan_uIuJL0xGokgrq', region: 'c', tier: 'monthly', price: 4.99, days: 30, pass: true, currency: 'inr', rupees: 469 },
  yearly: { id: 'plan_MThbWlrQARDTJ', region: 'c', tier: 'yearly', price: 39.99, days: 365, pass: true, currency: 'inr', rupees: 3749 },
};
/** Whether both UPI passes exist (their ids are filled in). */
export const upiReady = () => Object.values(upiPlans).every((p) => /^plan_\w+$/.test(p.id));
const upiPlanList = () => Object.values(upiPlans).filter((p) => !!p.id);
/** A regional plan (card or UPI) by id: a pass ends after its days, whichever way it was paid. */
export const regionalPlan = (planId: string | null | undefined) => [...allRegionalPlans(), ...upiPlanList()].find((p) => p.id === planId) ?? null;
/** Plans a welcome code is made for: every plan a new buyer may be offered (`upi` false: the card plans only). */
export const welcomeCodePlanIds = (upi = true) => [...allRegionalPlans(), ...(upi ? upiPlanList() : [])].map((p) => p.id);

/** Historical plans remain entitled without being offered to new customers; `pass`: one-time access that expires. */
export function membershipPlans(): { id: string; tier: AccessTier; pass?: boolean }[] {
  return [
    ...Object.entries(plans).map(([tier, plan]) => ({ id: required(plan.env), tier: tier as AccessTier })),
    { id: process.env.WHOP_LEGACY_MONTHLY_PLAN_ID || '', tier: 'monthly' as const },
    { id: process.env.WHOP_LIFETIME_PLAN_ID || '', tier: 'lifetime' as const },
    ...allRegionalPlans().map((p) => ({ id: p.id, tier: p.tier as AccessTier, pass: p.pass })),
    ...upiPlanList().map((p) => ({ id: p.id, tier: p.tier as AccessTier, pass: true })),
  ].filter(plan => !!plan.id);
}
