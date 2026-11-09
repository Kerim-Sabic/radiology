# Conversion notes (9 Nov 2026)

Data (Vercel events, 7-9 Nov, India): 427 case openers, 130 marked, 93 sign-up starts, 32 code_sent (about 35% of starts), 22 plans views, 2 checkout_ready, 1 checkout_start, 0 paid. Other countries barely engage.

## What changed
1. **Plans screen, India.** The rupee UPI pass is now the lead button on each plan card ("Pay ₹469 with UPI", "Pay ₹3,749 with UPI", with "Google Pay, PhonePe, Paytm or any UPI app. No card needed."); the card is a small second choice ("or pay $4.99 by card"). It starts UPI checkout in one tap (`buy(tier, 'upi')`). Before this, UPI appeared only after a plan had been clicked and the checkout opened. A signed-out visitor's UPI choice is remembered through sign-up (`rvm:selected-plan-method`).
2. **One plan leads** where prices are one-time passes (India and the other pass countries): the 30-day pass, shown first, with a "Smallest first payment" badge and the filled button. Why: the first payment is the barrier (a 30-day pass is $4.99 / ₹469); the yearly card stays beside it with its true per-month figure (₹312 a month in India) and its true saving (₹1,879 against twelve 30-day passes). Subscription countries and the standard price keep the yearly as the lead, as before.
3. **True anchors and loss framing only.** The 30-day pass says "about ₹16 a day" and "the standard price is $20 a month" (both are what the code charges); a signed-in free account is told its answers and scores stay on the account when it unlocks (true: the account keeps its history). The plan list states the real counts from `landingFacts` (600+ patients, 1,700+ tasks) and that access opens as soon as the payment is confirmed. The welcome gift already has a real 72-hour server-enforced expiry (Whop `expires_at`), a live countdown on the plans screen and the top bar, and a reminder email: nothing new was needed there. No guarantee or refund wording was added: no refund policy is written in the repo or docs.
4. **Sign-up drop.** Code review found no extra fields on our side (the form is Clerk's SignUp, email only, 6-digit code, `font-size:16px` inputs, the form's files are warmed after a guest's answer). What we could not see was the step between typing the email and the code, and in-app browsers. New events: `signup_submit`, `clerk_error` code `field`, `land.app` (instagram, facebook, webview) and finer `account_abandon` steps (`submitted`, `error`).
5. **Plans-page events** (see docs/TRACKING.md): `plans_view` gains `upi` and `rec`; `plan_click` gains `method`, `rec`, `via`; `checkout_close` is now sent (`loading` or `ready`).

## Paths to the plans (checked, not changed)
Already there: a guest's grade shows "Save it: free account"; a free account has the top "Free account / See plans" bar (or the welcome-gift countdown), "See the plans" after a grade, and a paywall on every locked page. The data shows the weak points are after the plans (22 views, 1 checkout) and before the code (65% lost), so no new prompt was added.

## What to measure next (Admin > Journeys, filter country IN)
- `plans_view.upi` true, then `plan_click` with `method=upi` and `via=plans`: share of plans viewers who press a plan (was about 9% to checkout start). Compare `rec` true versus false clicks.
- `checkout_ready` per `plan_click` (UPI checkout opens), then `checkout_close` with `step` `loading` versus `ready`: leaving before the form appears is a speed or error problem; leaving after it is a price or trust problem.
- Sign-up: `form_shown`, `email_focus`, `signup_submit`, `clerk_error` (`field`), `code_sent`; `account_abandon.step` ranks where they leave. Split by `land.app` to see whether Instagram's browser loses more people.
- `survey` answers on the plans (price, exam, upi...).

## Expected effect (a guess, not a measurement)
Showing UPI before the click removes one step and a hidden option for the visitors who cannot pay by card; I expect the plan-view to checkout-start rate to rise from about 9% to the high teens, but with 22 views a day this needs about 100 plan views to read. The sign-up changes only add measurement.

## Could not verify
- Real conversion: no payment exists to compare, and there is no baseline below 22 views.
- The Whop payment form's own interaction (typing, choosing UPI inside it): Whop's embed gives only `onReady` and `onComplete`, so `checkout_close` is the closest signal.
- Clerk's dashboard settings (email-only, blocked domains, allow-list), which are outside the repo; the `clerk_error` `field` event will show whether addresses are refused.
- Layout on real phones: checked in headless Chromium at 390 px only.
