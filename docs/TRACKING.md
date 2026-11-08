# Tracking: the anonymous event log, its dictionary, and how to read Admin → Journeys

Brief: `C:\Helix\Lab\Marketing\radiology-monster-instagram\PROMPT-TRACKING.md` (Kerim, 2026-11-07). The aim: see every step from an ad to a payment, per visitor, with times, without cookies or personal data.

## What is collected, in plain words (privacy)
- **A random visitor id.**
  - It's kept in the browser's local storage for 90 days.
  - It's made of random letters and says nothing about the person.
  - It isn't a cookie, and it's never shared with anyone.
- **A random session id**, kept in the tab's session storage.
- **Short events**, for example "saw the first image after 9 s", "marked it", "answered: correct", "pressed a plan". Each event may carry only the few named fields in the dictionary below: numbers, yes/no, or a short code such as a page path or a case id.
  - The server refuses anything else: unknown fields, any text with "@", any text over 80 characters.
- **Added by the server:**
  - the country (from Vercel's country header);
  - the device class (phone, tablet or desktop) and OS family;
  - the connection type the browser reports;
  - the ad tag the visitor arrived with.
  - For a signed-in account, a **salted hash** of the account id. It's the same for every event of that account and useless without the server's secret.
- **Never collected:** names, email addresses, IP addresses, the user agent itself, free text, answers' contents or card data.
- **Kept 90 days** (one Redis list per day, `rvm:ev:<day>`, which expires).
- **Not logged at all:**
  - localhost and preview deployments (only radiology.monster is kept);
  - the e2e suite (`x-rvm-test` header) and any automated browser (`navigator.webdriver`);
  - known bots and link previewers;
  - admin, owner and professor accounts;
  - any browser that opened `?internal=1` once. Kerim: open `https://www.radiology.monster/?internal=1` on each of your devices; `?internal=0` undoes it.
- **On the site:** the landing page's questions say this in one paragraph ("What do you measure about visits?").

**Cost.** None beyond the Redis already in use: about 1–5k events a day, a few commands per batch. Nothing here sets a cookie or loads a third-party script. Anything that would (Meta Pixel, Clarity, Resend tracking) waits for Kerim's yes (REQUESTS.md).

## How it is sent (performance)
- **Size:** `src/services/ev.ts`, 2.2 KB minified and 1.2 KB compressed on the wire.
- **Never blocks the first image:**
  - events queue in memory and leave in one batch every 5 s, at 30 events, or when the tab is hidden or closed (`sendBeacon`, else `fetch` with `keepalive`);
  - the batch goes to the same origin, `POST /api/ev`, which always answers 204.
- **The existing day counters** (`/api/track`, `/api/track/opened`, Admin's funnel and "Where sign-ups come from") keep running beside the log. Since 8 November 2026 they leave out the same traffic as the log (previews and localhost, the e2e suite, automated browsers, bots, the team, and browsers marked `?internal=1`), so both count the same visitors.

## The dictionary
"Once" means at most once per tab session. Times in `ms` are from the page's navigation start unless said otherwise.

### Arrival
| Event | When | Props | Answers |
|---|---|---|---|
| `land` | The app starts (once) | path, tag (ad tag), ref (referrer host), et (connection) | Where visitors arrive, from which ad and site, on what connection |
| `page` | A route change inside the app | path | Which pages a visit goes through |
| `leave` | The tab is closed or navigated away (`pagehide`) | path, last (the last event before leaving), secs (on this page) | **Where people leave, and right after what** |
| `active` | The first touch, key or scroll (once) | kind | Whether a human did anything: the "people only" filter |

### The free case
| Event | When | Props | Answers |
|---|---|---|---|
| `case_shell` | The reading room shows the task (once) | case, task, ms | How long until the visitor sees the question |
| `first_image` | The case's first image is on screen (once) | case, ms | **How long until the picture**, by country and connection |
| `image_error` | The image failed to load (once) | case, status | How often the first image fails |
| `slice_scroll` | (reserved) scrolling through slices | n | Whether they explore the scan |
| `tap_no_mark` | A tap with a viewing tool showed "choose Point first" | why (the tool) | Taps that did nothing |
| `mark` | The first mark (once) | task, tool, secs (since the image appeared) | Who tries, and after how long |
| `answer` | An answer is graded | task, mode, correct, score, assisted, secs | Who answers, and how they did |
| `grade_seen` | The grade is on screen | task | The grade was seen |
| `next_task` | The "Next: …" button after a grade | task | Whether the grade leads somewhere |
| `second_answer` | A second answer in the session (once) | task, correct | **Who keeps going** |

### The account
| Event | When | Props | Answers |
|---|---|---|---|
| `save_click` | "Start free" / "Save it" pressed | where (case, home, plans, invite) | Which door people take to an account |
| `form_shown` | Clerk's form is ready (once) | ms (after the dialog opened), mode | How long the sign-up form takes to appear |
| `email_focus` | The email field is tapped (once) | — | They started typing |
| `code_sent` | Clerk created the email code (once; from Clerk's own state, the address bar as fallback) | — | They asked for a code |
| `code_wrong` | A code was rejected | — | Codes that don't work |
| `code_resend` | A new code was asked for | — | Codes that didn't arrive |
| `clerk_error` | Clerk failed to load | code | Sign-up broken on that connection |
| `account` | Signed in after the code | new (first time?) | **Accounts, new vs returning** |
| `account_abandon` | The sign-up dialog closed without an account | step (opened, form_shown, email_focus, code_sent) | **How far they got before giving up** |

### Using it
| Event | When | Props | Answers |
|---|---|---|---|
| `study` | (reserved) time on a case | case, free, secs | — |
| `paywall` | A locked page was shown | what (case, library, feature, case_of_week), case, nth | **Which wall, how often, and what came next** |
| `return` | (reserved) a signed-in visit on a later day | days | — |

### Paying
| Event | When | Props | Answers |
|---|---|---|---|
| `plans_view` | The plans were on screen (once) | from (home, account), currency, regional, pass, student, code, monthly, yearly (the prices shown) | What price each visitor saw |
| `plan_click` | A plan button pressed | period, amount | **Who tries to buy** |
| `checkout_created` | *Server:* Whop's checkout was created | tier, regional | The server side of the click worked |
| `checkout_refused` | *Server:* the checkout was refused (already a member, a bad code, an error) | status | **Broken checkouts** |
| `checkout_ready` | Whop's payment form appeared (once) | ms (after it started loading) | How long the payment form takes |
| `checkout_close` | (reserved) the payment form closed without paying | step | — |
| `paid` | *Server:* the account became a paying member (once) | — | Payments, joined to the journey |
| `pay_declined` | *Server:* a declined payment (needs Whop's webhook; not yet connected) | reason, country | Why cards fail, by country |

### Email
| Event | When | Props | Answers |
|---|---|---|---|
| `email_visit` | A visit from an email link (tag `email:<campaign>`, once) | campaign (welcome, welcome_gift, …) | Which emails bring people back |
| `code_redeemed` | *Server:* (reserved; needs Whop's webhook) a welcome or student code used in a payment | kind | Whether the gift email sells |

### Errors, speed, experiments
| Event | When | Props | Answers |
|---|---|---|---|
| `js_error` | A script error (at most 5 a session) | h (a hash of the message), file, line | Broken pages, without user data |
| `api_error` | An API call that matters failed | route, status | Server errors on the path to paying |
| `slow` | A step took over 10 s (first image, payment form) | step, ms | Who waits too long |
| `exposure` | A visitor was shown an experiment's arm (once per experiment) | exp, arm | Who saw which version |
| `survey` | The one question on the plans, answered (once) | q (`plans_worth`), a (price, exam, upi, cases, looking) | **What would make it worth paying for** |

## Admin → Journeys: how to read it
All views take the filters: dates (up to 31 days), ad tag (prefix, e.g. `meta:reel002`), country (`IN`), device, connection, and **People only**. People only, on by default, keeps visitors who touched, typed or scrolled.
- **Yesterday vs the day before.** Kerim's 10-second view: visitors, saw a case image, answered, new accounts, saw the plans, pressed a plan, paid, and the median time to the first image.
- **Funnel.** Visitors reaching each step (each counted once), the share of the step before, and the median and 75th-percentile time from the visitor's first event.
  - Server steps (checkout created, paid) join the visitor through their account hash.
  - A big drop with a long time points to slowness. A big drop with a short time points to the page itself.
- **Where people leave.** The page and the last thing done before leaving it, ranked; also each session's very last step.
- **The paywall.** Which locked pages are hit most, and what the visitor did next: the plans, another free case, or leaving.
- **Paying.**
  - The chain from saw the plans → pressed a plan → checkout created → saw the payment form → paid;
  - checkouts the server refused, by HTTP status;
  - declines by country and reason, once Whop's webhook is connected.
- **Email.** Visits from each email campaign, and how many of those visitors paid.
- **Speed and errors.** Time to the first image (median and 75th percentile) by country and connection; sessions with image errors or script errors; steps over 10 s.
- **Sign-up cohorts.** New accounts per day, then:
  - studied the next day;
  - came back on days 2–7;
  - saw the plans;
  - paid, within 7 days.
- **Exports.**
  - "Funnel CSV": the funnel table.
  - "Events CSV": every event in the range, anonymous, for analysis by account 1 or account 3.

## Experiments
`src/services/experiments.ts`:
- A visitor's arm is a stable hash of their visitor id and the experiment, so they see the same arm every visit.
- The first use logs an `exposure`.
- Each experiment's plan (metric, visitors needed per arm, stop rule) is written in the code before it starts.
- Every experiment is `active: false` until Kerim says yes:

| Experiment | Arms | Decides on | Visitors per arm | Stop |
|---|---|---|---|---|
| `landing_mode` | Learn vs Practice on the ad's case | answered ÷ saw the image | 130 (24 % → 40 %) | 150 per arm or 14 days |
| `start_free_copy` | "Save it: free account" vs "Keep your score: free account" | Start free ÷ grade seen | ~100 | 120 per arm |
| `google_signin` | email only vs email + Google | account ÷ Start free | ~95 | 110 per arm |
| `plans_inr` | $ only vs $ with "about ₹…" | pressed a plan ÷ saw the plans | ~60 | 80 per arm |

## For Kerim (yes / no, in REQUESTS.md)
1. **Meta Pixel + Conversions API** (CompleteRegistration, then Purchase). Meta could then optimise for sign-ups and buyers, not the cheapest clicks.
   - Needs cookies, a consent banner for EU/UK visitors and a privacy-policy page.
   - Meta may restrict health-related events.
2. **Microsoft Clarity** session replay (free), all text and inputs masked, for 2 weeks on the plans and sign-in pages. Needs consent.
3. **Resend open/click tracking** on makeborne.com. It's domain-wide: Makeborne mail would be tracked too. The `utm` tags on email links already work without it.
4. **A one-question exit survey** on the plans page and after a paywall: four choices + other, stored as counts only.
5. **Whop webhook** (`payment.failed`, `payment.succeeded`) to an endpoint we add, for decline reasons by country. Needs Kerim to create the webhook in Whop and share its secret.
