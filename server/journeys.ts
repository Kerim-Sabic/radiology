import { readDay, type StoredBatch } from './events.js';

/**
 * Admin → Journeys: answers computed from the anonymous event log (server/events.ts) for a date range, with filters.
 * Visitors are counted by their random browser id; server events (checkout, payment) join a visitor through the
 * account's salted hash. Times are seconds from the visitor's first event in the range.
 */
export interface JourneyFilter {
  from: string;
  to: string;
  tag?: string;
  country?: string;
  device?: string;
  conn?: string;
  /** Only visitors who touched, typed or scrolled at least once (bots and accidental loads drop out). */
  humans?: boolean;
}

export const FUNNEL_STEPS = [
  'land',
  'first_image',
  'mark',
  'answer',
  'grade_seen',
  'save_click',
  'form_shown',
  'code_sent',
  'account',
  'plans_view',
  'plan_click',
  'checkout_created',
  'checkout_ready',
  'paid',
] as const;

interface Ev {
  t: number;
  n: string;
  p: Record<string, string | number | boolean>;
  vid: string;
  sid: string;
  a?: string;
  c?: string;
  d?: string;
  et?: string;
  tag?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
export function dayRange(from: string, to: string, max = 31): string[] {
  if (!DAY.test(from) || !DAY.test(to)) return [];
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < max; t += 86_400_000) out.push(day(t));
  return out;
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return Math.round((s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)) * 10) / 10;
}

/** Flattens stored batches into events; server events take the visitor of their account, when one is known. */
export function flatten(batches: StoredBatch[], f: Omit<JourneyFilter, 'from' | 'to'>): Ev[] {
  const vidOf = new Map<string, string>();
  for (const b of batches) if (b.a && b.vid) vidOf.set(b.a, b.vid);
  const out: Ev[] = [];
  for (const b of batches) {
    const vid = b.vid ?? (b.a ? vidOf.get(b.a) : undefined) ?? (b.a ? `acct:${b.a}` : undefined);
    if (!vid) continue;
    for (const [t, n, p] of b.ev) out.push({ t, n, p: p ?? {}, vid, sid: b.sid ?? vid, a: b.a, c: b.c, d: b.d, et: b.et, tag: b.tag });
  }
  out.sort((x, y) => x.t - y.t);
  // Filters apply to visitors (by their first event's tag, country, device, connection), so a journey stays whole.
  const first = new Map<string, Ev>();
  const human = new Set<string>();
  for (const e of out) {
    if (!first.has(e.vid) && !e.vid.startsWith('acct:')) first.set(e.vid, e);
    if (e.n === 'active') human.add(e.vid);
  }
  const keep = (vid: string) => {
    const e = first.get(vid);
    if (!e) return !f.tag && !f.country && !f.device && !f.conn && !f.humans;
    if (f.tag && !(e.tag ?? '').startsWith(f.tag)) return false;
    if (f.country && e.c !== f.country) return false;
    if (f.device && e.d !== f.device) return false;
    if (f.conn && e.et !== f.conn) return false;
    if (f.humans && !human.has(vid)) return false;
    return true;
  };
  return out.filter((e) => keep(e.vid));
}

const count = <T extends string>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export function journeys(events: Ev[], now = Date.now()) {
  const byVid = new Map<string, Ev[]>();
  for (const e of events) (byVid.get(e.vid) ?? byVid.set(e.vid, []).get(e.vid)!).push(e);
  const visitors = [...byVid.keys()].filter((v) => !v.startsWith('acct:'));

  // Funnel: visitors reaching each step, and how long it took them from their first event.
  let prev = 0;
  const funnel = FUNNEL_STEPS.map((step, i) => {
    const times: number[] = [];
    for (const [, evs] of byVid) {
      const hit = evs.find((e) => e.n === step);
      if (hit) times.push((hit.t - evs[0].t) / 1000);
    }
    const n = times.length;
    const row = { step, visitors: n, ofPrevious: i && prev ? Math.round((n / prev) * 1000) / 10 : null, medianS: quantile(times, 0.5), p75S: quantile(times, 0.75) };
    prev = n;
    return row;
  });

  // Where people leave: the last thing they did before leaving each page, and each session's very last event.
  const leaves = count(events.filter((e) => e.n === 'leave').map((e) => `${e.p.path ?? '?'} · after ${e.p.last || '(nothing)'}`)).slice(0, 15);
  const bySession = new Map<string, Ev[]>();
  for (const e of events) (bySession.get(e.sid) ?? bySession.set(e.sid, []).get(e.sid)!).push(e);
  const lastSteps = count([...bySession.values()].map((s) => s.filter((e) => e.n !== 'leave' && e.n !== 'active').pop()?.n ?? '(none)')).slice(0, 12);

  // Cohorts: new accounts per day → answered the next day → back on days 2–7 → saw the plans → paid, within 7 days.
  const cohorts = new Map<string, { accounts: number; studiedDay1: number; returned2to7: number; plans7: number; paid7: number }>();
  for (const [, evs] of byVid) {
    const acc = evs.find((e) => e.n === 'account' && e.p.new === true);
    if (!acc) continue;
    const d0 = Date.parse(`${day(acc.t)}T00:00:00Z`);
    const within = (lo: number, hi: number, names?: string[]) => evs.some((e) => e.t >= d0 + lo * 86_400_000 && e.t < d0 + hi * 86_400_000 && (!names || names.includes(e.n)));
    const row = cohorts.get(day(acc.t)) ?? { accounts: 0, studiedDay1: 0, returned2to7: 0, plans7: 0, paid7: 0 };
    row.accounts++;
    if (within(1, 2, ['answer', 'study', 'mark'])) row.studiedDay1++;
    if (within(2, 8)) row.returned2to7++;
    if (evs.some((e) => e.n === 'plans_view' && e.t >= acc.t && e.t < acc.t + 7 * 86_400_000)) row.plans7++;
    if (evs.some((e) => e.n === 'paid' && e.t >= acc.t && e.t < acc.t + 7 * 86_400_000)) row.paid7++;
    cohorts.set(day(acc.t), row);
  }

  // The paywall: what was locked, and what the visitor did next.
  const paywallHits = count(events.filter((e) => e.n === 'paywall').map((e) => `${e.p.what ?? '?'}${e.p.case ? ` · ${e.p.case}` : ''}`)).slice(0, 12);
  const afterPaywall = count(
    events
      .filter((e) => e.n === 'paywall')
      .map((e) => (bySession.get(e.sid) ?? []).find((x) => x.t > e.t && x.n !== 'active' && x.n !== 'paywall')?.n ?? '(nothing: left)'),
  );

  // Paying.
  const has = (name: string) => [...byVid.values()].filter((evs) => evs.some((e) => e.n === name)).length;
  const payment = {
    plansView: has('plans_view'),
    planClick: has('plan_click'),
    checkoutCreated: has('checkout_created'),
    checkoutReady: has('checkout_ready'),
    paid: has('paid'),
    declined: count(events.filter((e) => e.n === 'pay_declined').map((e) => `${e.p.country ?? '?'} · ${e.p.reason ?? '?'}`)),
    refused: count(events.filter((e) => e.n === 'checkout_refused').map((e) => String(e.p.status ?? '?'))),
  };

  // Email: visits from email links by campaign, codes redeemed, and payments by those visitors.
  const emailVids = new Map<string, string>();
  for (const e of events) if (e.n === 'email_visit') emailVids.set(e.vid, String(e.p.campaign ?? '?'));
  const email = count([...emailVids.values()]).map(([campaign, visits]) => ({
    campaign,
    visits,
    paid: [...emailVids].filter(([v, c]) => c === campaign && byVid.get(v)?.some((e) => e.n === 'paid')).length,
  }));
  const codesRedeemed = events.filter((e) => e.n === 'code_redeemed').length;
  // The one question on the plans: what would make it worth paying for.
  const survey = count(events.filter((e) => e.n === 'survey').map((e) => String(e.p.a ?? '?')));

  // Speed: time to the first image, by country and by connection; image and script errors per session.
  const firstImage = events.filter((e) => e.n === 'first_image' && typeof e.p.ms === 'number');
  const group = (key: (e: Ev) => string) =>
    count(firstImage.map(key))
      .slice(0, 8)
      .map(([k, n]) => {
        const ms = firstImage.filter((e) => key(e) === k).map((e) => Number(e.p.ms));
        return { key: k, n, p50: quantile(ms, 0.5), p75: quantile(ms, 0.75) };
      });
  const sessionsWith = (name: string) => new Set(events.filter((e) => e.n === name).map((e) => e.sid)).size;
  const speed = {
    firstImage: { n: firstImage.length, p50: quantile(firstImage.map((e) => Number(e.p.ms)), 0.5), p75: quantile(firstImage.map((e) => Number(e.p.ms)), 0.75) },
    byCountry: group((e) => e.c ?? '?'),
    byConnection: group((e) => e.et ?? '?'),
    imageErrorSessions: sessionsWith('image_error'),
    caseSessions: sessionsWith('case_shell'),
    jsErrorSessions: sessionsWith('js_error'),
    sessions: bySession.size,
    slow: count(events.filter((e) => e.n === 'slow').map((e) => String(e.p.step ?? '?'))),
  };

  // Kerim's 10-second view: yesterday against the day before.
  const today = day(now);
  const dayStats = (d: string) => {
    const evs = events.filter((e) => day(e.t) === d);
    const vids = (n?: string) => new Set(evs.filter((e) => !n || e.n === n).map((e) => e.vid)).size;
    return {
      day: d,
      visitors: new Set(evs.filter((e) => !e.vid.startsWith('acct:')).map((e) => e.vid)).size,
      sawImage: vids('first_image'),
      answered: vids('answer'),
      newAccounts: evs.filter((e) => e.n === 'account' && e.p.new === true).length,
      sawPlans: vids('plans_view'),
      pressedPlan: vids('plan_click'),
      paid: vids('paid'),
      firstImageP50: quantile(evs.filter((e) => e.n === 'first_image').map((e) => Number(e.p.ms)), 0.5),
    };
  };
  const yesterday = day(Date.parse(`${today}T00:00:00Z`) - 86_400_000);
  const dayBefore = day(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000);

  return {
    visitors: visitors.length,
    sessions: bySession.size,
    events: events.length,
    funnel,
    leaves,
    lastSteps,
    cohorts: [...cohorts.entries()].sort().map(([d, r]) => ({ day: d, ...r })),
    paywall: { hits: paywallHits, next: afterPaywall },
    payment,
    email: { campaigns: email, codesRedeemed },
    survey,
    speed,
    daily: { yesterday: dayStats(yesterday), dayBefore: dayStats(dayBefore), today: dayStats(today) },
  };
}

export async function loadEvents(f: JourneyFilter): Promise<Ev[]> {
  const days = dayRange(f.from, f.to);
  const batches = (await Promise.all(days.map((d) => readDay(d).catch(() => [])))).flat();
  return flatten(batches, f);
}

export async function journeyReport(f: JourneyFilter) {
  return { filter: f, ...journeys(await loadEvents(f)) };
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every event in the range, one per line, for analysis: no personal data is in the log to begin with. */
export async function eventsCsv(f: JourneyFilter): Promise<string> {
  const evs = await loadEvents(f);
  const lines = ['time_utc,visitor,session,account_hash,country,device,connection,ad_tag,event,props'];
  for (const e of evs) lines.push([new Date(e.t).toISOString(), e.vid, e.sid, e.a, e.c, e.d, e.et, e.tag, e.n, Object.keys(e.p).length ? e.p : ''].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

export function funnelCsv(report: ReturnType<typeof journeys>): string {
  const lines = ['step,visitors,percent_of_previous,median_seconds_from_first_event,p75_seconds'];
  for (const r of report.funnel) lines.push([r.step, r.visitors, r.ofPrevious ?? '', r.medianS ?? '', r.p75S ?? ''].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}
