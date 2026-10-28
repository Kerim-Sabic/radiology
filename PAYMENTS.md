# Accounts and payments

Radiology uses Whop email sign-in (OIDC with PKCE), Whop Elements embedded checkout, and Upstash Redis for sessions. Supabase and Google OAuth are not required. Card entry happens inside Whop's secure iframe on radiology.monster; payment details never pass through this application's server.

Visitors can choose a plan before signing in. The account dialog opens email verification in a separate window, then continues to the selected plan automatically. A full-page sign-in fallback is used if the browser blocks the window. Callback messages are bound to the app origin and the opened window, contain no credentials, and only trigger a fresh server session check.

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

`ADMIN_EMAILS` is a server-only comma-separated allowlist. Production includes `kerim.sabic@gmail.com`. A successful OIDC sign-in must provide a verified email matching this list exactly (case insensitive). That identity receives all app features without a payment, with an “Admin · free access” badge. Admin status is checked on every access request and is never cached. An existing user must sign in again after this feature is deployed so the verified identity is recorded. Removing the email revokes the exemption immediately. Client email input, checkout parameters, or a matching display name cannot grant admin access.

An opaque secure HttpOnly cookie identifies a Redis session. A new sign-in replaces the user's active device pointer. Previous devices lose authorization on their next request, and the app checks every 30 seconds and on focus. Already downloaded content cannot be remotely erased.

The server verifies the exact business, product and allowlisted plan, membership status, expiration, and the latest paid charge. Refunded or disputed payments do not unlock access. Results are cached for at most 30 seconds; returning from checkout triggers immediate checks. Webhooks are not required for this implementation. If Whop or Redis cannot verify access, access fails closed.

Checkout return parameters and browser completion events never grant access. Checkout creation validates the live plan price and uses a repeatable idempotency key. The browser receives only the checkout configuration ID and return URL; Elements renders the payment form with the verified buyer email locked. Existing active or payment-pending memberships cannot create another checkout from the app. Customers should use the same Whop account for sign-in and checkout. A completion event triggers server-side membership/payment verification; bank authentication may require an additional window or redirect.

Vercel routing middleware protects `/packs/*` and `/content/*`, including direct asset requests, before the CDN. Do not deploy this application as an unprotected static site. Published builds omit the textbook and the six noncommercial RICORD subjects; source files remain unchanged.

## Verification

Run `npm test`, `npm run typecheck`, `npm run build`, and `npx playwright test e2e/membership.spec.ts --project=chromium` with Node 24.15 or later. Membership browser tests mock account responses; they do not simulate a real charge. Existing viewer acceptance tests require an authorized-session fixture now that the app is gated.

Before launch, verify live sign-in, both checkout prices, anonymous direct-asset rejection, unpaid account rejection, and a genuine paid membership. A real charge must be explicitly authorized and should be followed by renewal, cancellation, refund, and second-device checks in Whop's test environment where available.
