# Account-sharing prevention plan

## Already enforced

The server allows one active application session per account. Every successful sign-in replaces the active-session pointer, and every authenticated request checks it. The previous session then receives 401. The app checks again every 30 seconds while visible and whenever the window regains focus, and closes protected access when the session ends. Cookies are HttpOnly, Secure in production, and SameSite=Lax. Entitlements are checked on the server.

This limits simultaneous use. It cannot prove who is using the account, stop someone forwarding an email code, or erase material already downloaded. Tabs in one browser may share a session; that is expected. Switching between a laptop and phone should remain possible.

## One active device, now that progress follows the account

Submitted answers are now saved to the account (`server/progressSync.ts`) and merged on every device, and the sync does not rely on one device at a time: the log is append-only and keeps each attempt id once, so two devices writing together cannot duplicate or lose an answer. The one-session rule is therefore only an account-sharing control, and its cost to honest learners has grown: syncing invites reading on a laptop and reviewing on a phone, and every switch ends the other device's session (answers that device had not uploaded wait in its browser until it signs in again).

Recommendation, not implemented (it changes access rules, so it is the owner's call):

1. Keep one active session for now; nothing in the sync needs it changed.
2. Next, allow two concurrent sessions per account (a computer and a phone), the oldest ending when a third signs in, together with the device list and "Sign out everywhere" in item 2 below. Two covers the usual personal pattern without making a shared account comfortable.
3. Before changing it, look at how often sessions are taken over today, and keep the takeover limits in item 3.

## Recommended next release

1. **Explicit device handover.** Before replacing an active session, say “Continue here and sign out your other device.” Require a fresh email verification challenge for a new browser or a suspiciously frequent handover, even when a Clerk session is still available. Do not silently reconnect the old device from a background session check.
2. **Session management.** Show the active device label and last activity in Account, with “Sign out everywhere.” Use a random first-party device identifier, never invasive fingerprinting. Store only the minimum metadata, with a documented retention period.
3. **Abuse throttling.** Rate-limit login challenges and repeated takeovers. Initially flag unusually frequent switching for review rather than banning users automatically. Explain the temporary delay and provide a recovery route. Tune thresholds from real usage before enforcement.
4. **Paid-content checks.** Audit every protected API, book route, download and signed asset link. Keep private downloads behind current entitlement/session checks; use short-lived signed links where needed. Already delivered files cannot be recalled.
5. **Clear policy and support.** Explain one person per account at sign-up and purchase, allow normal device replacement, and provide an appeal/recovery path. Avoid hard IP locks: hospital Wi-Fi, university networks, travel and mobile connections change addresses or share them.

## Acceptance checks before releasing extra controls

- Browser B signs in: A's next protected request fails, and its visible UI closes within the polling interval.
- Multiple tabs in the same browser continue normally.
- Expired/revoked sessions, sign-out everywhere and inactive memberships deny protected APIs and assets.
- Phone/laptop handover works after verification without an accidental permanent lockout.
- Repeated automatic retries cannot replace the active session or send unlimited emails.
- Hospital/university shared networks and mobile IP changes do not cause account bans.
- Offline/error states fail closed for new protected requests without deleting the learner's saved study work.

Certificates remain unproctored study-completion records. Account-session controls do not turn them into identity-verified examinations, accredited CME or clinical qualifications.
