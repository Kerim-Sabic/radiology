/** Mirrors server/regional.ts: the regional price for the visitor's country, while regional prices are on. */
export interface RegionalPrice {
  region: 'b' | 'c';
  country: string;
  countryName: string;
  monthly: { price: number; pass: boolean };
  yearly: { price: number; pass: boolean };
  /** A verified student's price there (30% off every payment), only while student prices are on for regional plans. */
  student?: { monthly: number; yearly: number };
  /** India: the same passes payable by UPI, in rupees (once the UPI plans exist). */
  upi?: { monthly: number; yearly: number };
  /** About how much a dollar is in the visitor's money today, to read the prices (the bank converts). */
  local?: { currency: string; perUsd: number; date: string };
}

/** "about ₹442": a dollar amount in the visitor's money, rounded the way prices are read (never what is charged). */
export function aboutLocal(usdAmount: number, local: RegionalPrice['local']): string | null {
  if (!local || !(local.perUsd > 0)) return null;
  const v = usdAmount * local.perUsd;
  const step = v >= 10_000 ? 100 : v >= 1_000 ? 10 : v >= 100 ? 1 : 0.1;
  const rounded = Math.round(v / step) * step;
  try {
    return `about ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: local.currency, maximumFractionDigits: step < 1 ? 1 : 0, minimumFractionDigits: 0 }).format(rounded)}`;
  } catch {
    return null;
  }
}

/** What the checkout answered for a regional price; `studentPrice` when the student's 30% code is on it; `method: 'upi'`
 *  with the rupee amount when the pass is paid by UPI. */
export interface RegionalCheckout { country: string; countryName: string; price: number; days: number; pass: boolean; studentPrice?: number; rupees?: number; method?: 'upi' }

/** "₹3,749": a rupee amount as shown in India. */
export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

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
export const regionalTerms = (c: Pick<RegionalCheckout, 'price' | 'days' | 'pass'> & Partial<Pick<RegionalCheckout, 'rupees' | 'method'>>) => {
  // A UPI pass is charged in rupees.
  const amount = c.method === 'upi' && c.rupees ? rupees(c.rupees) : `${usd(c.price)} USD`;
  return c.pass ? `${amount} for ${c.days} days, one payment that does not renew` : `${amount} every ${c.days} days`;
};

/** India, UPI passes: the yearly pass as a rupee amount a month, and what it saves against twelve 30-day passes. */
export function upiYearlyFigures(upi: { monthly: number; yearly: number }) {
  return { perMonth: rupees(Math.floor(upi.yearly / 12)), saves: rupees(Math.max(0, upi.monthly * 12 - upi.yearly)) };
}

/** Which plan card leads: the 30-day pass where prices are one-time passes (the smallest first payment), else the yearly. */
export const recommendedTier = (r: Pick<RegionalPrice, 'monthly'> | undefined): 'monthly' | 'yearly' => (r?.monthly.pass ? 'monthly' : 'yearly');
