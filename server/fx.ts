import { db } from './store.js';

/**
 * About how much a dollar price is in the visitor's own money, to help them read it: never what they are charged (their
 * bank converts, and the plans say so). The European Central Bank's reference rates, read once a day from
 * frankfurter.dev (free, no key, no visitor data sent) and kept in Redis; with no fresh rate, nothing is shown.
 * Only currencies the ECB publishes: India, the Philippines, Malaysia, Indonesia, Thailand, Turkey, South Africa,
 * Brazil, Mexico and some of Europe. Pakistan, Bangladesh, Nigeria, Egypt and Kenya get no estimate.
 */
export const LOCAL_CURRENCY: Record<string, string> = {
  IN: 'INR', PH: 'PHP', MY: 'MYR', ID: 'IDR', TH: 'THB', TR: 'TRY', ZA: 'ZAR', BR: 'BRL', MX: 'MXN',
  RO: 'RON', BG: 'BGN', PL: 'PLN', HU: 'HUF', CZ: 'CZK', KR: 'KRW', CN: 'CNY', IS: 'ISK',
};
const KEY = 'rvm:fx:usd';
const MAX_AGE_MS = 36 * 3_600_000;
export interface FxRates { at: number; date: string; rates: Record<string, number> }

let refreshing: Promise<void> | null = null;
/** Fetch today's rates (at most one request at a time; failures leave the old rates). */
export async function refreshFx(fetcher: typeof fetch = fetch): Promise<void> {
  refreshing ??= (async () => {
    try {
      const r = await fetcher('https://api.frankfurter.dev/v1/latest?from=USD', { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;
      const body = (await r.json()) as { date?: string; rates?: Record<string, number> };
      const rates = Object.fromEntries(Object.entries(body.rates ?? {}).filter(([k, v]) => /^[A-Z]{3}$/.test(k) && typeof v === 'number' && v > 0 && Number.isFinite(v)));
      if (Object.keys(rates).length) await db().set(KEY, { at: Date.now(), date: String(body.date ?? ''), rates } satisfies FxRates);
    } catch {
      /* no estimate today */
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** The visitor's currency and today's rate, or null. Never waits for the network: a stale or missing rate is refreshed
 *  in the background for the next visitor. */
export async function localMoney(country: string | null | undefined, now = Date.now()): Promise<{ currency: string; perUsd: number; date: string } | null> {
  const currency = LOCAL_CURRENCY[(country ?? '').toUpperCase()];
  if (!currency) return null;
  const fx = await db().get<FxRates>(KEY).catch(() => null);
  if (!fx || now - fx.at > MAX_AGE_MS / 1.5) void refreshFx();
  if (!fx || now - fx.at > MAX_AGE_MS) return null;
  const perUsd = fx.rates[currency];
  return perUsd ? { currency, perUsd, date: fx.date } : null;
}
