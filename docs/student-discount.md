# University email discount

New purchases with a server-verified academic email receive 30% off every renewal: $14 per 30 days or $105 per 365 days, before applicable taxes. The existing $20/$150 plan IDs, terms and subscriptions are unchanged.

Eligibility uses the saved verified identity, never email or eligibility fields from the checkout request. The explicit ICANN academic namespace list includes `.edu`, `.edu.ba`, `.ac.uk` and other listed `edu`/`ac` country namespaces. It is a domain-based offer, not verification of current enrolment; universities using unrelated domains are not automatically recognized. Refresh the list deliberately from its cited source when adding support.

The existing merchant credential must already have `promo_code:create` and `promo_code:basic:read`. This change does not modify OAuth scopes, credentials or the stored merchant connection. If Whop cannot confirm the offer, student checkout stops with a retry message rather than falling back to the standard price.

On eligible checkout, the server issues a random, plan-specific, single-redemption code valid for 24 hours. `promo_duration_months: 0` means forever in Whop's API; expiry limits redemption, not the discount on the resulting subscription. Retries share a saved idempotency key, then retrieve the current code to confirm its recurring terms and availability. Manual entry of generated student codes is rejected by the app. Whop does not offer an account-email restriction on these codes; a person who extracts a code could attempt direct redemption before its single use expires. The embedded form locks the buyer email to the signed-in account.

An available entered monthly promo with equal or greater recurring savings takes precedence. A smaller or first-payment-only discount is replaced by the student offer with an explanation. An invalid/exhausted code must be removed. Discounts never stack. Existing restrictions on manually entered yearly promotions remain in place.

Verification before release: `npm test`, `npm run build`, student and ordinary-account desktop/mobile previews, then an unpaid verified academic account in real Whop checkout on both plans. Confirm $14/30 days and $105/365 days without submitting payment. Also confirm the merchant can create/read the scoped promo and that an available stronger monthly recurring code still takes precedence. Local tests mock Whop and do not establish live provider permissions or a successful charge.

Provider reference: https://sandbox.whop.com/blog/add-promo-codes/
