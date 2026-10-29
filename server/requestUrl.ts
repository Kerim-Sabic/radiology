/** Preserve the public route whether Vercel supplies the source or rewritten URL. */
export function requestUrl(raw: string, host: string, route?: string | string[]): URL {
  const url = new URL(`https://${host}${raw.startsWith('/') ? raw : '/'}`);
  if (/^\/api\/index\/?$/.test(url.pathname)) {
    const routed = route ?? url.searchParams.get('__rvm_path');
    url.pathname = typeof routed === 'string' && /^[a-z]+(?:[/-][a-z]+)*$/.test(routed) ? `/api/${routed}` : '/api/not-found';
  } else if (/^\/certificate\/[^/]+\/?$/.test(url.pathname)) {
    url.searchParams.set('id', url.pathname.split('/')[2]);
    url.pathname = '/api/certificate-page';
  }
  url.searchParams.delete('__rvm_path');
  return url;
}
