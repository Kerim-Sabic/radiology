import type { Whop, WhopClient } from '@whop/sdk';
import { z } from 'zod';
import { plans, required, type Tier } from './config.js';
import { hash } from './auth.js';
import { whop } from './billing.js';
import { WELCOME_PREFIX } from './welcomeCode.js';

/**
 * Promo codes for the admin page, created and kept in Whop (Whop applies them at checkout and counts their uses).
 * The merchant connection needs promo_code:basic:read, :create, :update and :delete; without them Whop refuses and
 * the page says how to reconnect. Student offers the server issues one by one (rvmstudent…) are counted, not listed.
 */

const STUDENT_PREFIX = 'rvmstudent';

export interface Promo {
  id: string;
  code: string;
  type: 'percentage' | 'flat_amount';
  /** Percent off (1–100) or US dollars off. */
  amountOff: number;
  duration: 'once' | 'repeating' | 'forever';
  months: number | null;
  plans: Tier[];
  uses: number;
  /** Uses allowed in total (used + left), or null for no limit. */
  stock: number | null;
  /** Uses left, or null for no limit. */
  left: number | null;
  expiresAt: string | null;
  newUsersOnly: boolean;
  onePerCustomer: boolean;
  status: 'active' | 'inactive' | 'archived';
  createdAt: string;
}

export class PromoAccessError extends Error {}

/** Whop answers 401/403 when the merchant connection lacks the promo code permissions. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 401 || status === 403) throw new PromoAccessError('Whop has not given this app access to promo codes yet.');
    throw e;
  }
}

/** Current Whop versions return percentages as fractions; older versions returned percent points. */
const percent = (amount: number) => (amount <= 1 ? Math.round(amount * 10000) / 100 : amount);

async function codesFor(client: WhopClient, planId?: string) {
  const out: Whop.PromoCodeListItem[] = [];
  const list = await client.promoCodes.list({ account_id: required('WHOP_ACCOUNT_ID'), ...(planId ? { plan_ids: [planId] } : {}), first: 100 });
  for await (const c of list) out.push(c);
  return out;
}

export async function listPromos() {
  const client = await whop();
  const [all, monthly, yearly] = await call(() => Promise.all([codesFor(client), codesFor(client, required(plans.monthly.env)), codesFor(client, required(plans.yearly.env))]));
  const on = { monthly: new Set(monthly.map((c) => c.id)), yearly: new Set(yearly.map((c) => c.id)) };
  const studentOffers = all.filter((c) => c.code?.toLowerCase().startsWith(STUDENT_PREFIX));
  // Personal welcome codes (one per new account, server/welcome.ts) are counted like the student offers, not listed.
  const welcomeOffers = all.filter((c) => c.code?.toLowerCase().startsWith(WELCOME_PREFIX));
  const made = (c: Whop.PromoCodeListItem) => c.code?.toLowerCase().startsWith(STUDENT_PREFIX) || c.code?.toLowerCase().startsWith(WELCOME_PREFIX);
  const promos: Promo[] = all
    .filter((c) => !made(c) && c.status !== 'archived')
    .map((c) => ({
      id: c.id,
      code: c.code ?? '',
      type: c.promo_type,
      amountOff: c.promo_type === 'percentage' ? percent(c.amount_off) : c.amount_off,
      duration: c.duration,
      months: c.promo_duration_months,
      plans: (['monthly', 'yearly'] as const).filter((t) => on[t].has(c.id)),
      uses: c.uses,
      // Whop's `stock` counts down: it is the uses left, so the total is used + left.
      stock: c.unlimited_stock ? null : c.uses + c.stock,
      left: c.unlimited_stock ? null : c.stock,
      expiresAt: c.expires_at,
      newUsersOnly: c.new_users_only,
      onePerCustomer: c.one_per_customer,
      status: c.status,
      createdAt: c.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    promos,
    studentOffers: { issued: studentOffers.length, used: studentOffers.filter((c) => c.uses > 0).length },
    welcomeOffers: { issued: welcomeOffers.length, used: welcomeOffers.filter((c) => c.uses > 0).length },
  };
}

const CreateBody = z
  .object({
    code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/),
    type: z.enum(['percentage', 'flat_amount']),
    amountOff: z.number().positive(),
    plans: z.array(z.enum(['monthly', 'yearly'])).min(1).max(2),
    /** How long the discount lasts: the first payment, a number of months, or every payment. */
    duration: z.enum(['once', 'months', 'forever']),
    months: z.number().int().min(1).max(36).optional(),
    /** Uses allowed in total, or null for no limit. */
    stock: z.number().int().min(1).max(100_000).nullable(),
    /** Last day it can be used (YYYY-MM-DD), or null for no end. */
    lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    newUsersOnly: z.boolean(),
    onePerCustomer: z.boolean(),
  })
  .strict();

/** Create a promo code in Whop for the chosen plans. Codes are lower case, as checkout sends them. */
export async function createPromo(body: unknown) {
  const p = CreateBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Check the code (3–30 letters, digits, - or _), the discount and the plans.' };
  const d = p.data;
  const code = d.code.toLowerCase();
  if (code.startsWith(STUDENT_PREFIX)) return { ok: false as const, error: 'Codes starting with “rvmstudent” are kept for student offers.' };
  if (code.startsWith(WELCOME_PREFIX)) return { ok: false as const, error: 'Codes starting with “welcome-” are kept for the personal welcome offers.' };
  const cheapest = Math.min(...d.plans.map((t) => plans[t].price));
  if (d.type === 'percentage' ? d.amountOff > 100 || !Number.isInteger(d.amountOff) : d.amountOff > cheapest)
    return { ok: false as const, error: d.type === 'percentage' ? 'A percentage is a whole number from 1 to 100.' : `A dollar discount can be at most $${cheapest}, the price of the cheapest chosen plan.` };
  if (d.duration === 'months' && !d.months) return { ok: false as const, error: 'Choose for how many months the discount lasts.' };
  const expires = d.lastDay === null ? null : Date.parse(`${d.lastDay}T23:59:59.999Z`);
  if (expires !== null && (!Number.isFinite(expires) || new Date(expires).toISOString().slice(0, 10) !== d.lastDay || expires <= Date.now()))
    return { ok: false as const, error: 'Choose a last day in the future.' };
  const client = await whop();
  // An existing code with the same text (any status) would confuse checkout; Whop also refuses duplicates.
  const existing = await call(() => codesFor(client));
  if (existing.some((c) => c.code?.toLowerCase() === code)) return { ok: false as const, error: `The code “${code}” already exists. Choose another.` };
  const created = await call(() =>
    client.promoCodes.create(
      {
        account_id: required('WHOP_ACCOUNT_ID'),
        product_id: required('WHOP_PRODUCT_ID'),
        plan_ids: d.plans.map((t) => required(plans[t].env)),
        code,
        promo_type: d.type,
        amount_off: d.amountOff,
        base_currency: 'usd',
        // Whop: 0 is every payment; otherwise the number of billing months the discount lasts.
        promo_duration_months: d.duration === 'forever' ? 0 : d.duration === 'once' ? 1 : d.months!,
        new_users_only: d.newUsersOnly,
        churned_users_only: false,
        existing_memberships_only: false,
        one_per_customer: d.onePerCustomer,
        unlimited_stock: d.stock === null,
        ...(d.stock === null ? {} : { stock: d.stock }),
        expires_at: expires === null ? null : new Date(expires).toISOString(),
      },
      { idempotencyKey: `promo-${hash(JSON.stringify({ ...d, code }))}` },
    ),
  );
  return { ok: true as const, id: created.id, code };
}

const ChangeBody = z.object({ id: z.string().regex(/^promo_[A-Za-z0-9]+$/), action: z.enum(['pause', 'resume', 'delete']) }).strict();

/** Pause, resume or delete (archive) one of this business's codes. Memberships that already use it keep their discount. */
export async function changePromo(body: unknown) {
  const p = ChangeBody.safeParse(body);
  if (!p.success) return { ok: false as const, error: 'Expected a promo code and pause, resume or delete.' };
  const client = await whop();
  const found = await call(() => client.promoCodes.retrieve({ id: p.data.id }));
  if (found.account.id !== required('WHOP_ACCOUNT_ID') || found.code?.toLowerCase().startsWith(STUDENT_PREFIX) || found.code?.toLowerCase().startsWith(WELCOME_PREFIX)) return { ok: false as const, error: 'That promo code was not found.' };
  const { id, action } = p.data;
  await call<unknown>(() => (action === 'pause' ? client.promoCodes.deactivate({ id }) : action === 'resume' ? client.promoCodes.activate({ id }) : client.promoCodes.delete({ id })));
  return { ok: true as const, action };
}
