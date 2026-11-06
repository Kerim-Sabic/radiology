import { usd, yearlyFigures, type RegionalPrice } from './regionalPrice';

/** The price answers, with the visitor's regional price when it applies (the plan cards show the same price). */
export function priceAnswers(r?: RegionalPrice): Array<[string, string]> {
  if (!r) {
    return [
      ['How much does it cost?', 'A free account opens two sample patients, with grading and no card. Membership is $20 every 30 days, or $150 in one payment every 365 days (equal to $12.50 a month). An eligible university email gets 30% off: $14 every 30 days or $105 every 365 days.'],
      ['Is there a student discount?', 'Yes. Verify an eligible university email, including .edu, .edu.ba or .ac.uk, and get 30% off: $14 every 30 days or $105 every 365 days, including every renewal. It is applied automatically when you start a new membership. A better recurring promo takes precedence; discounts do not stack. Existing memberships are unchanged.'],
      ['How do I cancel?', 'Both plans renew, monthly every 30 days and yearly every 365 days, until you cancel future renewals from Billing. Have a promo code? Enter it before you choose a plan.'],
    ];
  }
  const where = r.countryName;
  const monthly = r.monthly.pass ? `a 30-day pass is ${usd(r.monthly.price)}` : `membership is ${usd(r.monthly.price)} every 30 days`;
  const yearly = r.yearly.pass
    ? `a 1-year pass is ${usd(r.yearly.price)} (equal to ${yearlyFigures(r).perMonth} a month)`
    : `${usd(r.yearly.price)} in one payment every 365 days (equal to ${yearlyFigures(r).perMonth} a month)`;
  const passes = r.monthly.pass && r.yearly.pass;
  // A verified student's price in the visitor's country (30% off every payment), while student prices are on there.
  const student = r.student
    ? passes
      ? `a 30-day pass is ${usd(r.student.monthly)} and a 1-year pass ${usd(r.student.yearly)}`
      : `${usd(r.student.monthly)} every 30 days or ${usd(r.student.yearly)} every 365 days`
    : '';
  return [
    ['How much does it cost?', `A free account opens two sample patients, with grading and no card. In ${where}, ${monthly}${r.monthly.pass ? ' and' : ', or'} ${yearly}${passes ? ': one payment each, and nothing renews' : ''}. Pay with a card issued in ${where}.${student ? ` With an eligible university email, ${student}.` : ''} Everywhere else, membership is $20 every 30 days or $150 every 365 days.`],
    ['Is there a student discount?', student
      ? `Yes. An eligible university email (.edu, .edu.ba, .ac.uk and others) gets 30% off the price for ${where}: ${student}, on every ${passes ? 'pass' : 'payment'}. Pay with a card issued in ${where}. It is applied automatically when you start a new membership; discounts do not stack. Everywhere else the student price is $14 every 30 days or $105 every 365 days.`
      : `Yes, on the standard price: an eligible university email (.edu, .edu.ba, .ac.uk and others) gets 30% off, $14 every 30 days or $105 every 365 days. In ${where} the price for your country is lower than that and applies instead; discounts do not stack.`],
    ['How do I cancel?', passes
      ? `In ${where} both plans are passes: one payment, nothing renews and there is nothing to cancel. Buy again when it ends. A promo code applies to the standard price, not to the price for ${where}.`
      : `Both plans renew, monthly every 30 days and yearly every 365 days, until you cancel future renewals from Billing. A promo code applies to the standard price, not to the price for ${where}.`],
  ];
}
