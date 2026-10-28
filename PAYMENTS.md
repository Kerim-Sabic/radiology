# Accounts and payments

Radiology uses Whop email sign-in (OIDC with PKCE), Whop hosted checkout, and Upstash Redis for sessions. Supabase and Google OAuth are not required.

## Offers

- Monthly: USD 10, billed every 30 days, no trial. Customers cancel future renewals in Whop.
- Lifetime: USD 100 once, no expiry or recurring charge.
- Both plans unlock the same application. The textbook is not included. Study progress is stored in the customer's browser.

## Server configuration

Configure `APP_URL`, `WHOP_APP_ID`, `WHOP_ACCOUNT_ID`, `WHOP_PRODUCT_ID`, `WHOP_MONTHLY_PLAN_ID`, and `WHOP_LIFETIME_PLAN_ID` in Vercel. Use `KV_REST_API_URL` and `KV_REST_API_TOKEN` from the Upstash integration (or their `UPSTASH_REDIS_REST_*` equivalents).

Merchant authorization uses `WHOP_OAUTH_ENABLED=1` and a secret `TOKEN_ENCRYPTION_KEY` containing 32 random bytes encoded as base64. Tokens are encrypted in Redis and refreshed with a distributed lock. An optional server-only `WHOP_API_KEY` can replace merchant OAuth. Never expose these values as Vite variables or commit environment files.

To reconnect the merchant, pull environment values securely into `.env.local`, set `WHOP_OWNER_USER_ID` to the business owner, and run `npx tsx --env-file=.env.local scripts/setup-whop-merchant.ts`. Open the URL written to `../whop-merchant-login-url.txt` and authorize the owner account. The callback uses `http://localhost:13338/callback`. Success must say “Radiology payments connected.”

The Whop app is a public OAuth client. Register `https://www.radiology.monster/api/auth/callback` and the local merchant callback. Customer sign-in requests only identity scopes. Merchant OAuth requests membership/payment reads and checkout creation for the configured business.

## Access enforcement

An opaque secure HttpOnly cookie identifies a Redis session. A new sign-in replaces the user's active device pointer. Previous devices lose authorization on their next request, and the app checks every 30 seconds and on focus. Already downloaded content cannot be remotely erased.

The server verifies the exact business, product and allowlisted plan, membership status, expiration, and the latest paid charge. Refunded or disputed payments do not unlock access. Results are cached for at most 30 seconds; returning from checkout triggers immediate checks. Webhooks are not required for this implementation. If Whop or Redis cannot verify access, access fails closed.

Checkout return parameters never grant access. Checkout creation validates the live plan price and uses a repeatable idempotency key. Existing active or payment-pending memberships cannot create another checkout from the app. Customers should use the same Whop account for sign-in and checkout.

Vercel routing middleware protects `/packs/*` and `/content/*`, including direct asset requests, before the CDN. Do not deploy this application as an unprotected static site. Published builds omit the textbook and the six noncommercial RICORD subjects; source files remain unchanged.

## Verification

Run `npm test`, `npm run typecheck`, `npm run build`, and `npx playwright test e2e/membership.spec.ts --project=chromium` with Node 24.15 or later. Membership browser tests mock account responses; they do not simulate a real charge. Existing viewer acceptance tests require an authorized-session fixture now that the app is gated.

Before launch, verify live sign-in, both checkout prices, anonymous direct-asset rejection, unpaid account rejection, and a genuine paid membership. A real charge must be explicitly authorized and should be followed by renewal, cancellation, refund, and second-device checks in Whop's test environment where available.
