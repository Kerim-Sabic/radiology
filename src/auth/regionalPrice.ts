/** Mirrors server/regional.ts: the regional price for the visitor's country, while regional prices are on. */
export interface RegionalPrice {
  region: 'b' | 'c';
  country: string;
  countryName: string;
  monthly: { price: number; pass: boolean };
  yearly: { price: number; pass: boolean };
  /** A verified student's price there (30% off every payment), only while student prices are on for regional plans. */
  student?: { monthly: number; yearly: number };
}

/** What the checkout answered for a regional price; `studentPrice` when the student's 30% code is on it. */
export interface RegionalCheckout { country: string; countryName: string; price: number; days: number; pass: boolean; studentPrice?: number }

/** The regional price with the student's 30% off in place of the price, for the plan cards. */
export const withStudentPrices = (r: RegionalPrice): RegionalPrice =>
  r.student ? { ...r, monthly: { ...r.monthly, price: r.student.monthly }, yearly: { ...r.yearly, price: r.student.yearly } } : r;

/** "$6.99 a month · $52.49 a year" (or "for 30 days · for a year" for passes): a student's price there. */
export const studentTerms = (r: RegionalPrice) =>
  r.student ? (r.monthly.pass ? `${usd(r.student.monthly)} for 30 days · ${usd(r.student.yearly)} for a year` : `${usd(r.student.monthly)} a month · ${usd(r.student.yearly)} a year`) : '';

/** "$9.99", "$75", "$6.25". */
export const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`;

/** The yearly price as a monthly figure, and what it saves against twelve monthly payments. */
export function yearlyFigures(r: RegionalPrice) {
  return { perMonth: usd(Math.floor((r.yearly.price / 12) * 100) / 100), saves: usd(Math.round((r.monthly.price * 12 - r.yearly.price) * 100) / 100) };
}

/** One line for the checkout: "$9.99 USD every 30 days" or "$4.99 USD for 30 days, one payment". */
export const regionalTerms = (c: Pick<RegionalCheckout, 'price' | 'days' | 'pass'>) =>
  c.pass ? `${usd(c.price)} USD for ${c.days} days, one payment that does not renew` : `${usd(c.price)} USD every ${c.days} days`;
