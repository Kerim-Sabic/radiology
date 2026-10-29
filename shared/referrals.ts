/** Whop referral links carry a public username, never an email or arbitrary URL. */
export function affiliateCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,99}$/.test(code) ? code : undefined;
}

export const affiliatePortal = 'https://whop.com/radiology-monster/affiliates/';
export const affiliateBalance = 'https://whop.com/@me/settings/balance/';
