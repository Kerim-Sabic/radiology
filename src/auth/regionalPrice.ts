/** Mirrors server/regional.ts: the regional price for the visitor's country, while regional prices are on. */
export interface RegionalPrice {
  region: 'b' | 'c';
  country: string;
  countryName: string;
  monthly: { price: number; pass: boolean };
  yearly: { price: number; pass: boolean };
}

/** What the checkout answered for a regional price. */
export interface RegionalCheckout { country: string; countryName: string; price: number; days: number; pass: boolean }

/** "$9.99", "$75", "$6.25". */
export const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`;

/** The yearly price as a monthly figure, and what it saves against twelve monthly payments. */
export function yearlyFigures(r: RegionalPrice) {
  return { perMonth: usd(Math.floor((r.yearly.price / 12) * 100) / 100), saves: usd(Math.round((r.monthly.price * 12 - r.yearly.price) * 100) / 100) };
}

/** One line for the checkout: "$9.99 USD every 30 days" or "$4.99 USD for 30 days, one payment". */
export const regionalTerms = (c: Pick<RegionalCheckout, 'price' | 'days' | 'pass'>) =>
  c.pass ? `${usd(c.price)} USD for ${c.days} days, one payment that does not renew` : `${usd(c.price)} USD every ${c.days} days`;
