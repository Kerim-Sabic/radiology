import type { Whop, WhopClient } from '@whop/sdk';
import { allRegionalPlans, regionalPlans, required, type Region, type RegionalPlan } from './config.js';
import { db } from './store.js';

/**
 * Regional prices (the plans are in server/config.ts). Three locks keep them for the countries they are meant for:
 *
 * 1. The server picks the plan from Vercel's IP country; the browser never names a plan, and a promo code always goes
 *    with the standard price.
 * 2. Whop payment rules (Whop → Settings → Payment rules) charge a regional price only to a card issued in that region:
 *    a "block" rule for each regional amount, and an "allow" rule (allow wins in Whop) for the same amount when the
 *    card's country is on the list. A VPN changes the IP, not the card; PayPal, crypto and banks have no card country,
 *    so nothing allows them, and the plans take cards only anyway.
 * 3. A regional membership gives access only when Whop recorded one of those allow rules on its first payment. So a
 *    payment that got past a missing or changed rule still opens nothing, and the admin page lists it for a refund.
 *
 * Regional prices stay off until an admin turns them on, which needs every plan set up right and one real payment the
 * allow rule approved (proof that the rules work).
 */

/** Countries where a regional price applies (ISO 3166-1 alpha-2, as Vercel and Whop report them). */
export const REGION_COUNTRIES: Record<Region, readonly string[]> = {
  // About half price: the Balkans and Eastern Europe, Turkey, the Caucasus, Latin America, Southeast Asia, North Africa.
  b: ['BA', 'RS', 'ME', 'MK', 'AL', 'XK', 'MD', 'UA', 'BG', 'RO', 'GE', 'AM', 'AZ', 'KZ', 'TR',
    'BR', 'MX', 'AR', 'CO', 'PE', 'EC', 'BO', 'PY', 'VE', 'GT', 'HN', 'SV', 'NI', 'DO', 'JM',
    'ID', 'VN', 'PH', 'TH', 'MY', 'MN', 'MA', 'TN', 'DZ', 'JO', 'LB', 'IQ', 'ZA'],
  // About a quarter of the price, as one-time passes: South and Central Asia, and Africa.
  c: ['IN', 'PK', 'BD', 'NP', 'LK', 'UZ', 'TJ', 'KG', 'MM', 'KH', 'LA',
    'EG', 'NG', 'KE', 'GH', 'ET', 'TZ', 'UG', 'RW', 'ZM', 'ZW', 'SN', 'CM', 'CI'],
};

export function regionOf(country?: string | null): Region | null {
  const code = (country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return (Object.keys(REGION_COUNTRIES) as Region[]).find((r) => REGION_COUNTRIES[r].includes(code)) ?? null;
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The allow rules in Whop are named starting with this; the server recognises them by it on each payment. */
export const ALLOW_RULE_PREFIX = 'RVM regional allow';
const LIVE_KEY = 'rvm:regional:live';
const guardedKey = (membershipId: string) => `rvm:regional:guarded:${membershipId}`;

export async function regionalLive(): Promise<boolean> {
  return (await db().get(LIVE_KEY)) === true;
}

export interface RegionalOffer {
  region: Region;
  country: string;
  countryName: string;
  monthly: { price: number; pass: boolean };
  yearly: { price: number; pass: boolean };
}

/** The regional price for a country while regional prices are on; null anywhere else (and if the store is down). */
export async function regionalOffer(country?: string | null): Promise<RegionalOffer | null> {
  const region = regionOf(country);
  if (!region || !(await regionalLive().catch(() => false))) return null;
  const code = country!.trim().toUpperCase();
  const p = regionalPlans[region];
  return {
    region, country: code, countryName: countryName(code),
    monthly: { price: p.monthly.price, pass: p.monthly.pass },
    yearly: { price: p.yearly.price, pass: p.yearly.pass },
  };
}

const CARD_METHODS = new Set(['card', 'apple_pay', 'google_pay']);

/** What is wrong with a regional plan in Whop, in plain words for the admin page; empty when it is right. */
export function regionalPlanProblems(plan: Whop.Variant, want: RegionalPlan): string[] {
  const problems: string[] = [];
  if (plan.account?.id !== required('WHOP_ACCOUNT_ID')) problems.push('belongs to another Whop business');
  if ((plan.product as { id?: string } | null)?.id !== required('WHOP_PRODUCT_ID')) problems.push('is on another product');
  if (plan.currency !== 'usd') problems.push('is not in US dollars');
  if (plan.visibility !== 'hidden') problems.push('is not hidden from the store page');
  if (plan.trial_period_days) problems.push('has a free trial');
  if (plan.split_pay_required_payments) problems.push('has split pay');
  if (plan.adaptive_pricing_enabled) problems.push('accepts local currency payments');
  if (want.pass) {
    if (plan.plan_type !== 'one_time' || plan.initial_price !== want.price || plan.expiration_days !== want.days) {
      problems.push(`should be a one-time $${want.price} pass that expires after ${want.days} days`);
    }
  } else if (plan.plan_type !== 'renewal' || plan.initial_price !== 0 || plan.renewal_price !== want.price
    || plan.billing_period !== want.days || plan.expiration_days) {
    problems.push(`should renew at $${want.price} every ${want.days} days with no setup fee`);
  }
  // What checkout offers: Whop's defaults when include_platform_defaults is on, else the enabled list.
  const methods = plan.effective_payment_method_configuration;
  const offered = methods && !methods.include_platform_defaults ? methods.enabled.filter((m) => !methods.disabled.includes(m)) : null;
  if (!offered || !offered.includes('card') || offered.some((m) => !CARD_METHODS.has(m))) {
    problems.push('should take only card, Apple Pay and Google Pay');
  }
  return problems;
}

type RuleMatches = { payment_rule_matches?: Array<{ action: string; name: string | null }> | null };
/** Whether one of the regional allow rules approved this payment (the card was issued in the region). */
export const guardMatched = (payment: RuleMatches) =>
  (payment.payment_rule_matches ?? []).some((m) => m.action === 'allow' && (m.name ?? '').startsWith(ALLOW_RULE_PREFIX));
const ruleBlocked = (payment: RuleMatches) => (payment.payment_rule_matches ?? []).some((m) => m.action === 'block');

async function withRuleMatches(client: WhopClient, payment: Whop.Payment) {
  return Array.isArray(payment.payment_rule_matches) ? payment : await client.payments.retrieve({ id: payment.id });
}

/** Whether a regional membership's first payment was approved by an allow rule. Remembered once it was. */
export async function regionalMembershipGuarded(client: WhopClient, membershipId: string): Promise<boolean> {
  if ((await db().get(guardedKey(membershipId))) === true) return true;
  const list = await client.payments.list({
    account_id: required('WHOP_ACCOUNT_ID'), membership_id: membershipId, status: 'paid', order: 'created_at', direction: 'asc', first: 1,
  });
  const first = list.data[0];
  if (!first) return false;
  const ok = guardMatched(await withRuleMatches(client, first));
  if (ok) await db().set(guardedKey(membershipId), true);
  return ok;
}

/** A payment amount as a number: list items carry a number, full payments a Money object ({ amount: "9.99" }). */
function dollars(value: unknown): number | null {
  if (typeof value === 'number') return value;
  const amount = Number((value as { amount?: unknown } | null)?.amount);
  return Number.isFinite(amount) ? amount : null;
}

const planLabel = (p: RegionalPlan) =>
  `${p.region.toUpperCase()} ${p.pass ? (p.tier === 'monthly' ? '30-day pass' : '1-year pass') : p.tier} $${p.price}`;

export interface RegionalPaymentRow {
  id: string;
  plan: string;
  status: string | null;
  amount: number | null;
  createdAt: string;
  /** An allow rule approved it (true), it was not approved (false), or its rules could not be read (null). */
  approved: boolean | null;
  blocked: boolean;
}

/** Everything the admin page shows about regional prices. */
export async function regionalStatus(client: WhopClient) {
  const live = await regionalLive();
  const plans = await Promise.all(allRegionalPlans().map(async (p) => {
    try {
      return { id: p.id, label: planLabel(p), region: p.region, problems: regionalPlanProblems(await client.variants.retrieve({ id: p.id }), p) };
    } catch {
      return { id: p.id, label: planLabel(p), region: p.region, problems: ['could not be read from Whop'] };
    }
  }));
  const payments: RegionalPaymentRow[] = [];
  for (const p of allRegionalPlans()) {
    const list = await client.payments.list({ account_id: required('WHOP_ACCOUNT_ID'), plan_id: p.id, order: 'created_at', direction: 'desc', first: 10 });
    for (const item of list.data) {
      const full = await withRuleMatches(client, item).catch(() => null);
      payments.push({
        id: item.id, plan: planLabel(p), status: item.status ?? null, amount: dollars(item.usd_total) ?? dollars(item.total), createdAt: item.created_at,
        approved: full ? guardMatched(full) : null, blocked: full ? ruleBlocked(full) : false,
      });
    }
  }
  payments.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const ready = plans.every((p) => !p.problems.length);
  const verified = payments.some((p) => p.status === 'paid' && p.approved === true);
  return {
    ok: true as const,
    live,
    ready,
    verified,
    plans,
    payments: payments.slice(0, 20),
    /** Paid regional payments no allow rule approved: they opened nothing and should be refunded in Whop. */
    unapproved: payments.filter((p) => p.status === 'paid' && p.approved === false).length,
    rulePrefix: ALLOW_RULE_PREFIX,
    countries: REGION_COUNTRIES,
    prices: allRegionalPlans().map((p) => ({ label: planLabel(p), region: p.region, price: p.price, link: `https://whop.com/checkout/${p.id}` })),
  };
}

/** Turns regional prices on (only when every plan is right and a real payment proved the rules work) or off. */
export async function setRegionalLive(client: WhopClient, live: boolean): Promise<{ ok: true; live: boolean } | { ok: false; error: string }> {
  if (!live) {
    await db().del(LIVE_KEY);
    return { ok: true, live: false };
  }
  const status = await regionalStatus(client);
  if (!status.ready) return { ok: false, error: 'A regional plan in Whop is not set up right yet. Fix what the list says first.' };
  if (!status.verified) return { ok: false, error: 'No payment has been approved by a regional allow rule yet. Make one test payment with a card from the region first.' };
  await db().set(LIVE_KEY, true);
  return { ok: true, live: true };
}
