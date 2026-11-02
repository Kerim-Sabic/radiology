import type { Whop, WhopClient } from '@whop/sdk';
import { academicEmail, STUDENT_PERCENT, STUDENT_PRICES } from '../shared/studentDiscount.js';
import { hash, random } from './auth.js';
import { plans, required, type Tier } from './config.js';
import { db } from './store.js';

const PREFIX = 'rvmstudent';
const OFFER_SECONDS = 24 * 60 * 60;
type Offer = { code: string; expiresAt: string; key: string; id?: string };

export class StudentDiscountError extends Error {}

export async function studentEligible(userId: string): Promise<boolean> {
  const identity = await db().get<{ email: string; emailVerified: boolean }>(`rvm:identity:${userId}`);
  return identity?.emailVerified === true && academicEmail(identity.email);
}

/** Current Whop versions return percentages as fractions; older versions returned percent points. */
function percentage(amount: number) { return amount <= 1 ? amount * 100 : amount; }

function available(code: Whop.PromoCode | Whop.PromoCodeListItem): boolean {
  return code.status === 'active'
    && (!code.expires_at || Date.parse(code.expires_at) > Date.now())
    && (code.unlimited_stock || code.uses < code.stock)
    && (!code.product || code.product.id === required('WHOP_PRODUCT_ID'));
}

/** Compare recurring savings, not a large first-payment discount that later becomes more expensive. */
function atLeastStudent(code: Whop.PromoCode | Whop.PromoCodeListItem, tier: Tier): boolean {
  const standard = plans[tier].price;
  return code.duration === 'forever' && !code.churned_users_only && !code.existing_memberships_only
    && (code.promo_type === 'percentage' ? percentage(code.amount_off) >= STUDENT_PERCENT
      : code.currency === 'usd' && code.amount_off >= standard - STUDENT_PRICES[tier]);
}

/** Issue one unguessable, expiring redemption per account and plan. Existing subscriptions are never edited. */
async function studentCode(client: WhopClient, userId: string, planId: string): Promise<string> {
  const storageKey = `rvm:student-offer:${userId}:${planId}`;
  await db().set(storageKey, {
    code: `${PREFIX}${hash(random()).slice(0, 24)}`,
    expiresAt: new Date(Date.now() + OFFER_SECONDS * 1000).toISOString(),
    key: random(),
  } satisfies Offer, { nx: true, ex: OFFER_SECONDS });
  const offer = await db().get<Offer>(storageKey);
  if (!offer || Date.parse(offer.expiresAt) <= Date.now()) throw new StudentDiscountError('Your student offer expired. Please retry.');
  try {
    const created = offer.id ? null : await client.promoCodes.create({
      account_id: required('WHOP_ACCOUNT_ID'), product_id: required('WHOP_PRODUCT_ID'), plan_ids: [planId],
      code: offer.code, amount_off: STUDENT_PERCENT, base_currency: 'usd', promo_type: 'percentage',
      promo_duration_months: 0, new_users_only: false, churned_users_only: false, existing_memberships_only: false,
      one_per_customer: true, unlimited_stock: false, stock: 1, expires_at: offer.expiresAt,
    }, { idempotencyKey: offer.key });
    const id = offer.id ?? created!.id;
    if (!offer.id) await db().set(storageKey, { ...offer, id }, { ex: Math.max(1, Math.floor((Date.parse(offer.expiresAt) - Date.now()) / 1000)) });
    // A replayed create response can be stale after redemption: check current availability.
    const result = await client.promoCodes.retrieve({ id });
    // Do not show a payment form unless Whop confirms the promised recurring offer.
    if (result.account.id !== required('WHOP_ACCOUNT_ID') || !available(result) || result.code?.toLowerCase() !== offer.code || result.promo_type !== 'percentage'
      || percentage(result.amount_off) !== STUDENT_PERCENT || result.duration !== 'forever'
      || result.product?.id !== required('WHOP_PRODUCT_ID') || result.unlimited_stock || result.stock !== 1
      || !result.expires_at || Date.parse(result.expires_at) > Date.parse(offer.expiresAt) + 1000
      || !result.one_per_customer || result.existing_memberships_only || result.churned_users_only || result.new_users_only) {
      throw new Error('Unexpected student offer');
    }
    return offer.code;
  } catch {
    throw new StudentDiscountError('We could not confirm your 30% student offer. Please retry shortly. No payment has been taken.');
  }
}

export async function checkoutDiscount(client: WhopClient, userId: string, tier: Tier, planId: string, requestedCode?: string) {
  const promo = requestedCode?.trim().toLowerCase();
  // Generated offers are issued by this server, never accepted as a transferable app promo entry.
  if (promo?.startsWith(PREFIX)) throw new StudentDiscountError('Student offers are applied automatically after verifying an eligible university email. Remove this code and try again.');
  if (!await studentEligible(userId)) return { ...(promo ? { promoCode: promo } : {}) };
  if (promo) {
    const codes = await client.promoCodes.list({ account_id: required('WHOP_ACCOUNT_ID'), plan_ids: [planId], status: 'active', first: 100 });
    let match: Whop.PromoCodeListItem | undefined;
    for await (const code of codes) if (code.code?.toLowerCase() === promo) { match = code; break; }
    if (!match || !available(match)) throw new StudentDiscountError('That code is not available for this plan. Remove it to use your 30% student discount.');
    if (atLeastStudent(match, tier)) return { promoCode: promo, studentDiscount: false };
  }
  return { promoCode: await studentCode(client, userId, planId), studentDiscount: true };
}
