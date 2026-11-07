import { useEffect, useState } from 'react';
import { usd, type RegionalPrice } from './regionalPrice';

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

/** First-payment prices with the welcome code (rounded to the cent as Whop does: 40% off $9.99 is $5.99). */
export const welcomePrice = (price: number, percent: number) => {
  const v = Math.round(price * (100 - percent)) / 100;
  return `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
};

/** The same in rupees, for a UPI pass (to the paisa: 40% off ₹469 is ₹281.40). */
export const welcomeRupees = (rupees: number, percent: number) => {
  const v = Math.round(rupees * (100 - percent)) / 100;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** What the code takes off, at the standard prices or at the price for the visitor's country. */
export function welcomeTerms(percent: number, regional?: RegionalPrice | null): string {
  if (!regional) return `Yearly ${welcomePrice(150, percent)} for your first year instead of $150 · Monthly ${welcomePrice(20, percent)} for your first month instead of $20. Renewals at the standard price.`;
  const { yearly, monthly } = regional;
  return monthly.pass
    ? `1-year pass ${welcomePrice(yearly.price, percent)} instead of ${usd(yearly.price)} · 30-day pass ${welcomePrice(monthly.price, percent)} instead of ${usd(monthly.price)}. One payment, nothing renews.`
    : `Yearly ${welcomePrice(yearly.price, percent)} for your first year instead of ${usd(yearly.price)} · Monthly ${welcomePrice(monthly.price, percent)} for your first month instead of ${usd(monthly.price)}. Renewals at the price for ${regional.countryName}.`;
}
