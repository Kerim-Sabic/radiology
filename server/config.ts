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
/** Historical plans remain entitled without being offered to new customers. */
export function membershipPlans(): { id: string; tier: AccessTier }[] {
  return [
    ...Object.entries(plans).map(([tier, plan]) => ({ id: required(plan.env), tier: tier as AccessTier })),
    { id: process.env.WHOP_LEGACY_MONTHLY_PLAN_ID || '', tier: 'monthly' as const },
    { id: process.env.WHOP_LIFETIME_PLAN_ID || '', tier: 'lifetime' as const },
  ].filter(plan => !!plan.id);
}
