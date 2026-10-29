# Accounts and payments

Radiology uses Clerk email-code signup/sign-in on the page, Whop Elements embedded checkout, and Upstash Redis for sessions. Supabase and Google OAuth are not required. Card entry happens inside Whop's secure iframe on radiology.monster; payment details never pass through this application's server.

Visitors can choose a plan before signing in. The account dialog accepts their email and verification code without leaving the site, then continues to the selected plan. The backend validates the Clerk token, session status and verified primary email before creating the app session. Whop OAuth remains available for compatibility with older deployments when Clerk is not configured.

Apple Pay is enabled through Whop Elements for eligible devices/browsers with an available wallet. The public `/.well-known/apple-developer-merchantid-domain-association` route serves Whop's association file unchanged. Whop's domain record for `www.radiology.monster` must show `apple_pay.state: ready`. Other customers can use the card form. A Windows browser cannot validate an actual Apple Pay authorization sheet.

## Offers

- Monthly: USD 20, billed every 30 days, no trial. Customers cancel future renewals in Whop.
- Yearly: USD 150, billed every 365 days, no trial.
- Both plans unlock the same application and the protected on-site textbook reader. Study progress is stored in the customer's browser.

Historical monthly/lifetime plan IDs remain allowlisted through `WHOP_LEGACY_MONTHLY_PLAN_ID` and `WHOP_LIFETIME_PLAN_ID`. Existing subscriptions and their discounts are not migrated or repriced. The original one-use `nadin` promotion keeps its $1/month recurring offer on the legacy plan. Enter it in the website promo field before choosing monthly; the server selects the original plan, and Whop Elements applies the code on its first quote. Whop enforces the redemption limit and displays any invalid/used-code error before payment. The redeemed `empa` subscription remains unchanged.

## Server configuration

Configure `APP_URL`, `WHOP_APP_ID`, `WHOP_ACCOUNT_ID`, `WHOP_PRODUCT_ID`, `WHOP_MONTHLY_PLAN_ID`, and `WHOP_YEARLY_PLAN_ID` in Vercel. Use `KV_REST_API_URL` and `KV_REST_API_TOKEN` from the Upstash integration (or their `UPSTASH_REDIS_REST_*` equivalents). Clerk's Marketplace integration supplies `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Only the publishable key is returned to the browser. The production Clerk domain is `clerk.www.radiology.monster`; email-code authentication and verified email at signup are enabled.

Merchant authorization uses `WHOP_OAUTH_ENABLED=1` and a secret `TOKEN_ENCRYPTION_KEY` containing 32 random bytes encoded as base64. Tokens are encrypted in Redis and refreshed with a distributed lock. An optional server-only `WHOP_API_KEY` can replace merchant OAuth. Never expose these values as Vite variables or commit environment files.

To reconnect the merchant, pull environment values securely into `.env.local`, set `WHOP_OWNER_USER_ID` to the business owner, and run `npx tsx --env-file=.env.local scripts/setup-whop-merchant.ts`. Open the URL written to `../whop-merchant-login-url.txt` and authorize the owner account. The callback uses `http://localhost:13338/callback`. Success must say “Radiology payments connected.”

The Whop app is a public OAuth client. Register `https://www.radiology.monster/api/auth/callback` and the local merchant callback. Legacy customer sign-in requests only identity scopes. Merchant OAuth requests membership/payment reads, `member:email:read`, and checkout creation for the configured business. Clerk accounts link to Whop only through an exact verified-email match within that business. Ambiguous matches fail closed.

## Access enforcement

`ADMIN_EMAILS` is a server-only comma-separated allowlist. Production includes `kerim.sabic@gmail.com`. A successful server-verified sign-in must provide a verified email matching this list exactly (case insensitive). That identity receives all app features without a payment, with an “Admin · free access” badge. Admin status is checked on every access request and is never cached. An existing user must sign in again after this feature is deployed so the verified identity is recorded. Removing the email revokes the exemption immediately. Client email input, checkout parameters, or a matching display name cannot grant admin access.

An opaque secure HttpOnly cookie identifies a Redis session. A new sign-in replaces the user's active device pointer. Previous devices lose authorization on their next request, and the app checks every 30 seconds and on focus. Already downloaded content cannot be remotely erased.

The server verifies the exact business, product and allowlisted plan, membership status, expiration, and the latest paid charge. Refunded or disputed payments do not unlock access. Results are cached for at most 30 seconds; returning from checkout triggers immediate checks. Webhooks are not required for this implementation. If Whop or Redis cannot verify access, access fails closed.

Checkout return parameters and browser completion events never grant access. Checkout creation validates the live plan price and uses a repeatable idempotency key. The browser receives only the checkout configuration ID and return URL; Elements renders the payment form with the verified buyer email locked. Existing active or payment-pending memberships cannot create another checkout from the app. Existing customers should sign in with the email used for their Whop purchase. A completion event triggers server-side membership/payment verification; bank authentication may require an additional window or redirect.

Vercel routing middleware protects `/packs/*` and `/content/*`, including direct asset requests, before the CDN. Do not deploy this application as an unprotected static site. Published static builds omit the textbook and the six noncommercial RICORD subjects; source files remain unchanged.

**Free accounts.** A signed-in account without a plan gets the free edition: the sample patients in `src/content/weekly.ts` (`FREE_CASES`) and this week's case of the week (`WEEKLY_CASES`, weeks start Monday 00:00 UTC). The middleware lets such an account fetch only `index.free.json`, the `*.free.json` manifests and lessons, `teaser.json` (every patient by neutral title, no diagnosis), the curriculum, and the exact files of those patients (`server/freeEdition.generated.ts`); everything else answers 402. After changing the free cases or the schedule, run `npm run free:sync` (a unit test fails until the generated list matches). The build writes the free manifests beside the commercial packs.

The requested fifth-edition book is stored in the private `radiology-book` Vercel Blob store. `/api/book` checks the active app session and membership (or verified admin access) for every HEAD/range request, and serves it only to verified `@stu.ssst.edu.ba` emails (`servesBook` in `server/book.ts`); every other member opens their own copy, which stays in the browser. `BLOB_READ_WRITE_TOKEN` is server-only and supplied by the connected store. PDF.js retrieves ranges of at most 1 MiB; the endpoint rejects requests over 2 MiB and sends private/no-store headers. Storage URLs and tokens are never sent to the browser. The 73,363,798-byte source matches the existing 552-page chapter/figure map and its SHA-256 in `server/book.ts`.

## Emails, certificates and numbers

- `RESEND_API_KEY` and `EMAIL_FROM` (a verified sender, e.g. `radiology.monster <hello@radiology.monster>`) send the streak reminder and the case-of-the-week email through Resend. Without them nothing is sent.
- `CRON_SECRET` protects `/api/cron/daily` (17:00 UTC, streak reminders) and `/api/cron/weekly` (Monday 07:00 UTC); Vercel Cron sends it automatically. `EMAIL_SECRET` signs unsubscribe links (falls back to `CRON_SECRET`). Every email carries `List-Unsubscribe` with one-click unsubscribe.
- Learners opt in under Settings → Emails or from the prompt on Today. The server keeps only which days they studied (for the streak) and their email choices; answers stay in the browser.
- Certificates (`/api/certificates`, members only) are issued from the bar the app shows (10 patients, 70% of graded answers) and have a public page at `/certificate/<id>`. They record practice as reported by the learner's app and say so.
- Vercel Web Analytics (enable it in the project's Analytics tab) counts page views without cookies; query strings are dropped. The app also keeps daily counters for the funnel (landing visit, Start free, account, first answer, plans opened, checkout, paid) and day-1 / day-7 return, shown to admins at `/admin`.

## Verification

Run `npm test`, `npm run typecheck`, `npm run build`, and `npx playwright test e2e/membership.spec.ts --project=chromium` with Node 24.15 or later. Membership browser tests mock account responses; they do not simulate a real charge. Existing viewer acceptance tests require an authorized-session fixture now that the app is gated.

Before launch, verify live sign-in, both checkout prices, anonymous direct-asset rejection, unpaid account rejection, and a genuine paid membership. A real charge must be explicitly authorized and should be followed by renewal, cancellation, refund, and second-device checks in Whop's test environment where available.
