/**
 * The campaign a visitor arrived from: `?utm_source=instagram&utm_campaign=find-it` (or `?src=…`) on an ad or post link.
 * Kept in this browser for 30 days, the latest tagged link winning, and sent with the funnel counts and the first sign-in
 * so the admin page can say which ad brings sign-ups and payments. No cookies, nothing about the person.
 */
const KEY = 'rvm.source';
const DAYS_30 = 30 * 86_400_000;

const clean = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export function adSource(now = Date.now()): string | null {
  const q = new URLSearchParams(location.search);
  const source = q.get('utm_source') ?? q.get('src');
  const campaign = q.get('utm_campaign');
  const fromLink = clean(campaign ? `${source ?? 'ad'}:${campaign}` : (source ?? ''));
  try {
    if (fromLink.length >= 2) {
      localStorage.setItem(KEY, JSON.stringify({ source: fromLink, at: now }));
      return fromLink;
    }
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { source?: string; at?: number } | null;
    return kept?.source && kept.at && now - kept.at < DAYS_30 ? kept.source : null;
  } catch {
    return fromLink.length >= 2 ? fromLink : null;
  }
}
