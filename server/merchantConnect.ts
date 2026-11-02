import { WhopClient } from '@whop/sdk';
import { cookie, equal, hash, random, readCookie } from './auth.js';
import { appOrigin, required } from './config.js';
import { encrypt, exchange, identity, merchantToken } from './oauth.js';
import { db } from './store.js';
import { studentCode, STUDENT_READY_KEY } from './studentDiscount.js';

export const MERCHANT_COOKIE = '__Host-rvm-merchant';
// Preserve the existing merchant grant and add only the owner-approved promo scopes: create and read for student
// offers, update and delete for pausing and deleting codes on the admin page.
export const MERCHANT_SCOPES = 'openid profile email company:basic:read member:basic:read member:email:read member:manage payment:basic:read plan:basic:read checkout_configuration:create promo_code:create promo_code:basic:read promo_code:update promo_code:delete';
type Flow = { nonce: string; verifier: string; ownerId: string };
const clientFor = (token: string) => new WhopClient({ token, apiVersionDate: '2026-10-15-1', timeoutInSeconds: 15, maxRetries: 1 });

async function verifyBusiness(client: WhopClient) {
  // Use the existing plan-read permission; account retrieval needs a different grant.
  const plan = await client.variants.retrieve({ id: required('WHOP_MONTHLY_PLAN_ID') });
  if (plan.id !== required('WHOP_MONTHLY_PLAN_ID') || plan.account?.id !== required('WHOP_ACCOUNT_ID')
    || plan.product?.id !== required('WHOP_PRODUCT_ID')) throw new Error('The authorized business does not match.');
}

export async function beginMerchantConnect() {
  if (process.env.WHOP_API_KEY) throw new Error('This deployment uses an API key rather than the merchant OAuth connection.');
  required('TOKEN_ENCRYPTION_KEY');
  const token = await merchantToken();
  // The stored connection was owner-authorized. Bind renewal to that same identity.
  const response = await fetch('https://api.whop.com/oauth/userinfo', {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Could not verify the existing merchant identity.');
  const owner = await response.json();
  if (typeof owner.sub !== 'string' || !owner.sub.startsWith('user_') || owner.email_verified !== true) throw new Error('Could not verify the existing merchant identity.');
  await verifyBusiness(clientFor(token));
  const state = `merchant.${random()}`, nonce = random(), verifier = random();
  await db().set(`rvm:merchant-flow:${hash(state)}`, { nonce, verifier, ownerId: owner.sub } satisfies Flow, { ex: 600 });
  const params = new URLSearchParams({ client_id: required('WHOP_APP_ID'), response_type: 'code', redirect_uri: `${appOrigin()}/api/auth/callback`,
    scope: MERCHANT_SCOPES, company_id: required('WHOP_ACCOUNT_ID'), state, nonce,
    code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256' });
  return { url: `https://api.whop.com/oauth/authorize?${params}`, cookie: cookie(MERCHANT_COOKIE, state, 600) };
}

export async function finishMerchantConnect(request: Request) {
  const url = new URL(request.url), state = url.searchParams.get('state') || '';
  if (url.origin !== appOrigin() || !/^merchant\.[\w-]{43}$/.test(state) || !equal(state, readCookie(request, MERCHANT_COOKIE))) throw new Error('Invalid merchant authorization state.');
  const flow = await db().getdel<Flow>(`rvm:merchant-flow:${hash(state)}`);
  const code = url.searchParams.get('code');
  if (!flow || !code) throw new Error('Merchant authorization expired or was canceled.');
  const tokens = await exchange({ grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: `${appOrigin()}/api/auth/callback` });
  const owner = await identity(tokens, flow.nonce);
  if (owner.sub !== flow.ownerId) throw new Error('Authorize using the existing Whop business owner account.');
  const client = clientFor(tokens.access_token);
  await verifyBusiness(client);
  // Prove both added permissions before replacing the working connection or enabling student prices.
  await client.promoCodes.list({ account_id: required('WHOP_ACCOUNT_ID'), first: 1 });
  await studentCode(client, `merchant-check:${hash(state)}`, required('WHOP_MONTHLY_PLAN_ID'), 600);
  const lock = random();
  if (!await db().set('rvm:merchant-refresh', lock, { nx: true, ex: 45 })) throw new Error('Merchant authorization is refreshing. Please retry.');
  try {
    const tx = db().multi();
    tx.set('rvm:merchant', encrypt(tokens));
    tx.set(STUDENT_READY_KEY, true);
    await tx.exec();
  } finally {
    await db().eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", ['rvm:merchant-refresh'], [lock]);
  }
}

export function merchantConnectPage(result?: boolean) {
  const title = result === undefined ? 'Enable university discounts' : result ? 'Student discounts are connected' : 'Merchant connection was not updated';
  const message = result === undefined
    ? 'Authorize with the existing Whop business owner account. This adds permission to create, read, pause and delete promo codes. Existing payment, membership and plan permissions stay the same. No payment is taken.'
    : result ? 'Whop confirmed promo creation and reading. The verified connection is saved securely, and university pricing is enabled. Return to the app to verify the checkout totals.'
      : 'The owner or promo permissions could not be verified. The previous stored connection was preserved. Please retry with the business owner account.';
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · radiology.monster</title></head><body style="font:16px system-ui;background:#0c1016;color:#e7ebf0;max-width:640px;margin:60px auto;padding:24px"><h1>${title}</h1><p>${message}</p>${result === true ? '<a href="/">Return to radiology.monster</a>' : '<form method="post" action="/api/merchant/connect"><button type="submit">Authorize promo permissions in Whop</button></form>'}</body></html>`, {
    status: result === false ? 400 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'origin',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://api.whop.com https://whop.com; base-uri 'none'; frame-ancestors 'none'" },
  });
}
