import { useEffect, useState } from 'react';

/** A new account's personal welcome code (server/welcomeCode.ts): 40% off the first payment until `expiresAt`. */
export interface WelcomeOffer {
  code: string;
  expiresAt: string;
  percent: number;
}

/** "2 days 5 h", "5 h 12 min", "12 min"; null once it has ended. */
export function timeLeft(ms: number): string | null {
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} h` : ''}`;
  if (hours) return `${hours} h${mins ? ` ${mins} min` : ''}`;
  return `${mins} min`;
}

/** The time left on an offer, updated every 30 seconds; null when there is none or it has ended. */
export function useOfferTimeLeft(offer: WelcomeOffer | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [offer]);
  return offer ? timeLeft(Date.parse(offer.expiresAt) - now) : null;
}

/** First-payment prices with the welcome code. */
export const welcomePrice = (price: number, percent: number) => {
  const v = Math.round(price * (100 - percent)) / 100;
  return `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
};
