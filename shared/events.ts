/**
 * The anonymous event log's dictionary (docs/TRACKING.md explains each event and the question it answers). The browser
 * may send only the client events; the server adds the server events itself. Every prop is a short string, a number or
 * a boolean: no names, emails, free text, IPs or card data ever (the server rejects strings with "@" or over 80 chars).
 */
export type PropType = 's' | 'n' | 'b';
type Spec = Record<string, PropType>;

export const CLIENT_EVENTS = {
  // Arrival
  land: { path: 's', tag: 's', ref: 's', et: 's', app: 's' },
  page: { path: 's' },
  leave: { path: 's', last: 's', secs: 'n' },
  active: { kind: 's' },
  // The free case
  case_shell: { case: 's', task: 's', ms: 'n' },
  first_image: { case: 's', ms: 'n' },
  image_error: { case: 's', status: 'n' },
  slice_scroll: { n: 'n' },
  tap_no_mark: { why: 's' },
  mark: { task: 's', tool: 's', secs: 'n' },
  answer: { task: 's', mode: 's', correct: 'b', score: 'n', assisted: 'b', secs: 'n' },
  grade_seen: { task: 's' },
  next_task: { task: 's' },
  second_answer: { task: 's', correct: 'b' },
  // The account
  save_click: { where: 's' },
  form_shown: { ms: 'n', mode: 's' },
  email_focus: {},
  signup_submit: {},
  code_sent: {},
  code_wrong: {},
  code_resend: {},
  clerk_error: { code: 's' },
  account: { new: 'b' },
  account_abandon: { step: 's' },
  // Using it
  study: { case: 's', free: 'b', secs: 'n' },
  paywall: { case: 's', what: 's', nth: 'n' },
  return: { days: 'n' },
  // Paying
  plans_view: { from: 's', currency: 's', regional: 'b', pass: 'b', student: 'b', code: 'b', monthly: 'n', yearly: 'n', upi: 'b', rec: 's' },
  plan_click: { period: 's', amount: 'n', method: 's', rec: 'b', via: 's' },
  checkout_ready: { ms: 'n' },
  checkout_close: { step: 's' },
  // Email
  email_visit: { campaign: 's' },
  // Errors and speed
  js_error: { h: 's', file: 's', line: 'n' },
  api_error: { route: 's', status: 'n' },
  slow: { step: 's', ms: 'n' },
  // Experiments
  exposure: { exp: 's', arm: 's' },
  // The one question on the plans (src/auth/WorthSurvey.tsx): one of a few fixed answers, never free text.
  survey: { q: 's', a: 's' },
} as const satisfies Record<string, Spec>;

/** Logged by the server only (a browser can't fake a checkout or a payment). */
export const SERVER_EVENTS = {
  checkout_created: { tier: 's', regional: 'b' },
  checkout_refused: { status: 'n' },
  paid: { tier: 's' },
  // A confirmed payment as the ad measurement saw it (server/metaAds.ts): the paid value, whether the Conversions API and
  // the browser copy went out, why not, and whether Meta's test code was on. Never the person.
  purchase: { value: 'n', currency: 's', capi: 'b', browser: 'b', why: 's', test: 'b' },
  pay_declined: { reason: 's', country: 's' },
  code_redeemed: { kind: 's' },
} as const satisfies Record<string, Spec>;

export type ClientEvent = keyof typeof CLIENT_EVENTS;
export type ServerEvent = keyof typeof SERVER_EVENTS;
export type EventName = ClientEvent | ServerEvent;
type Value<T extends PropType> = T extends 's' ? string : T extends 'n' ? number : boolean;
export type PropsOf<E extends ClientEvent> = { [K in keyof (typeof CLIENT_EVENTS)[E]]?: Value<(typeof CLIENT_EVENTS)[E][K] & PropType> };

/** The log's version: a change to the shape of a batch bumps it. */
export const EV_VERSION = 1;
/** Hosts whose events are kept: everything else (localhost, previews) is dropped by the server. */
export const EV_HOSTS = ['www.radiology.monster', 'radiology.monster'];
