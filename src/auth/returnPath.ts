/**
 * The page a visitor signs up from is kept through Clerk's redirects, so a link to a free case (an ad, a post, a
 * professor's message) opens that case right after the account is made, not the home page. Same-origin paths only.
 */
type Where = Pick<Location, 'pathname' | 'search'>;

/** The current address with `account=<value>` set (Clerk returns here after verifying the email). */
export function withAccount(value: 'verified' | 'login' | 'signup', where: Where = location) {
  const q = new URLSearchParams(where.search);
  q.set('account', value);
  return `${where.pathname}?${q}`;
}

/** The same address without the account flag, once the session is open: the case and its task stay. */
export function withoutAccount(where: Where = location) {
  const q = new URLSearchParams(where.search);
  q.delete('account');
  const rest = q.toString();
  return `${where.pathname}${rest ? `?${rest}` : ''}`;
}
