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
  const billing = auth && merchant && ['WHOP_ACCOUNT_ID', 'WHOP_PRODUCT_ID', 'WHOP_MONTHLY_PLAN_ID', 'WHOP_LIFETIME_PLAN_ID'].every(k => !!process.env[k]);
  return { auth, billing, authProvider: clerk ? 'clerk' : 'whop', clerkPublishableKey: clerk ? clerkPublishableKey : undefined };
}

export const plans = {
  monthly: { title: 'Monthly', price: 10, env: 'WHOP_MONTHLY_PLAN_ID' },
  lifetime: { title: 'Lifetime', price: 100, env: 'WHOP_LIFETIME_PLAN_ID' },
} as const;
export type Tier = keyof typeof plans;
